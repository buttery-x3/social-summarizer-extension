import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Dispatcher, safeError } from '../apps/helper/src/native/dispatcher.ts';
import { HOST_NAME, type Response } from '@social-summarizer/protocol';
import type { SummaryBackend } from '../apps/helper/src/native/backend.ts';

const host = { name: HOST_NAME, pid: 42, nodeVersion: 'v24.15.0', platform: 'win32' };
const start = (id: string, transcript = 'Jo: Thursday deadline.') => ({ version: 2, id, type: 'summary.start', transcript });
const terminal = (responses: Response[], id: string) => responses.filter(r => r.id === id && r.type !== 'summary.progress');
const deferred = () => { let resolve!: (value: { model: string; text: string }) => void; const promise = new Promise<{ model: string; text: string }>(r => { resolve = r; }); return { resolve, promise }; };

test('provider codes/status map to actionable fixed messages without provider/session data', () => {
  for (const [error, expected] of [[{ code: 'invalid_refresh_token' }, 'SIGN_IN_REQUIRED'], [{ code: 'chatpass_v2_scope_not_authorized' }, 'PLAN_DISABLED'],
    [{ status: 429 }, 'USAGE_LIMIT'], [{ status: 503 }, 'NETWORK_ERROR'], [{ status: 403 }, 'HELPER_ERROR']]) {
    const response = safeError('test', { ...(error as object), message: 'synthetic-private-token', profile: { credentials: 'synthetic-private-token' } });
    assert.equal(response.type === 'error' && response.error.code, expected);
    assert.equal(JSON.stringify(response).includes('synthetic-private-token'), false);
  }
});

test('native request text reaches model boundary; both changed fixtures complete with one terminal', async () => {
  const seen: string[] = [];
  const responses: Response[] = [];
  const backend: SummaryBackend = { status: async () => ({ connected: true, planEnabled: true }),
    summarise: async (text, _signal, stage) => { seen.push(text); stage(); return { model: 'fixture-model', text }; } };
  const dispatcher = new Dispatcher(host, backend, r => responses.push(r));
  for (const [id, text] of [['first', 'Jo: Thursday deadline.'], ['second', 'Jo: Sunday deadline.']]) {
    dispatcher.accept(start(id!, text)); await delay(0);
    assert.deepEqual(terminal(responses, id!), [{ version: 2, id, type: 'summary.result', model: 'fixture-model', text }]);
    assert.deepEqual(responses.filter(r => r.id === id && r.type === 'summary.progress').map(r => r.type === 'summary.progress' && r.stage), ['checking', 'summarising']);
  }
  assert.deepEqual(seen, ['Jo: Thursday deadline.', 'Jo: Sunday deadline.']);
  await dispatcher.close();
});

test('double start, duplicate ID and target cancellation never cause duplicate or late success', async () => {
  const waiting = deferred(); const responses: Response[] = []; let calls = 0; let signal!: AbortSignal;
  const dispatcher = new Dispatcher(host, { status: async () => ({ connected: true, planEnabled: true }),
    summarise: async (_text, abort, stage) => { calls++; signal = abort; stage(); return waiting.promise; } }, r => responses.push(r));
  dispatcher.accept(start('one')); dispatcher.accept(start('one')); dispatcher.accept(start('two'));
  dispatcher.accept({ version: 1, id: 'one', type: 'unsupported' });
  assert.equal(calls, 1);
  assert.ok(responses.some(r => r.type === 'error' && r.id === null && r.error.code === 'DUPLICATE_ID'));
  assert.ok(responses.some(r => r.type === 'error' && r.id === 'two' && r.error.code === 'BUSY'));
  dispatcher.accept({ version: 2, id: 'wrong-target', type: 'summary.cancel', targetId: 'two' });
  assert.equal(signal.aborted, false);
  dispatcher.accept({ version: 2, id: 'cancel', type: 'summary.cancel', targetId: 'one' });
  assert.equal(signal.aborted, true);
  assert.equal(terminal(responses, 'one').length, 1);
  assert.equal(terminal(responses, 'one')[0]?.type, 'summary.cancelled');
  waiting.resolve({ model: 'fixture-model', text: 'Late success' }); await delay(0);
  assert.equal(terminal(responses, 'one').length, 1);
  dispatcher.accept(start('retry')); await delay(0);
  assert.equal(terminal(responses, 'retry')[0]?.type, 'summary.result');
  await dispatcher.close();
});

test('timeout and closure abort; ignored cancellation cannot become success', async () => {
  for (const mode of ['timeout', 'close']) {
    const waiting = deferred(); const responses: Response[] = []; let signal!: AbortSignal;
    const dispatcher = new Dispatcher(host, { status: async () => ({ connected: true, planEnabled: true }),
      summarise: async (_text, abort) => { signal = abort; return waiting.promise; } }, r => responses.push(r), 15);
    dispatcher.accept(start('one'));
    let closing: Promise<void> | undefined;
    if (mode === 'close') closing = dispatcher.close(); else await delay(30);
    assert.equal(signal.aborted, true);
    waiting.resolve({ model: 'fixture-model', text: 'Late output' }); await delay(0); await closing;
    assert.equal(responses.some(r => r.type === 'summary.result'), false);
    assert.equal(terminal(responses, 'one').length, mode === 'close' ? 0 : 1);
    if (mode === 'timeout') { const error = terminal(responses, 'one')[0]; assert.equal(error?.type === 'error' && error.error.code, 'TIMEOUT'); await dispatcher.close(); }
  }
});

test('empty/oversized inputs never reach model and unsafe/partial/oversized outputs fail safely', async () => {
  let calls = 0; let outcome = 'empty'; const responses: Response[] = [];
  const dispatcher = new Dispatcher(host, { status: async () => ({ connected: false, planEnabled: false }),
    summarise: async () => { calls++; if (outcome === 'partial') throw { code: 'stream_interrupted', message: 'synthetic-private-token' };
      return { model: outcome === 'bad-model' ? 'invalid model secret' : 'fixture-model', text: outcome === 'empty' ? '' : outcome === 'bad-model' ? 'Summary' : '世'.repeat(30_000) }; } }, r => responses.push(r));
  dispatcher.accept(start('empty', ' ')); dispatcher.accept(start('large', '世'.repeat(30_000))); assert.equal(calls, 0);
  for (const [mode, code] of [['empty', 'INCOMPLETE_RESPONSE'], ['partial', 'INCOMPLETE_RESPONSE'], ['large', 'OUTPUT_TOO_LARGE'], ['bad-model', 'HELPER_ERROR']]) {
    outcome = mode!; dispatcher.accept(start(mode!)); await delay(0);
    const error = terminal(responses, mode!).at(-1);
    assert.equal(error?.type === 'error' && error.error.code, code);
  }
  assert.equal(JSON.stringify(responses).includes('synthetic-private-token'), false);
  await dispatcher.close();
});
