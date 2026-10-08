import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../apps/helper/src/native/handle-request.ts';
import { CAPABILITIES, HOST_NAME, PROTOCOL_VERSION, MAX_FRAME_BYTES, isSuccessResponse, isResponse, validateRequest, fitsFrame } from '@social-summarizer/protocol';

const host = { name: HOST_NAME, pid: 42, nodeVersion: 'v24.15.0', platform: 'win32' };
test('hello/ping preserve request ID and advertise v2 capabilities', () => {
  for (const type of ['hello', 'ping']) {
    const response = handleRequest({ version: PROTOCOL_VERSION, id: 'req-123', type }, host);
    assert.deepEqual(response, { version: PROTOCOL_VERSION, id: 'req-123', type: type === 'hello' ? 'hello' : 'pong', host, capabilities: CAPABILITIES });
    assert.ok(isSuccessResponse(response));
  }
});
test('invalid shapes, IDs, unsupported operations and versions fail clearly', () => {
  for (const value of [null, [], 'hello', {}, { version: 2, id: '', type: 'hello' },
    { version: 2, id: 'x'.repeat(81), type: 'ping' }, { version: 2, id: 'x', type: 'exec' },
    { version: 2, id: 'x', type: 'ping', command: 'anything' },
    { version: 2, id: 'x', type: 'summary.start', transcript: '  ' },
    { version: 2, id: 'x', type: 'summary.cancel', targetId: 'x' },
    { version: 2, id: 'x', type: 'summary.cancel', targetId: 'not safe!' }]) {
    const result = validateRequest(value);
    assert.equal(result.type, 'error');
    if (result.type === 'error') assert.equal(result.error.code, 'INVALID_REQUEST');
  }
  const mismatch = validateRequest({ version: 1, id: 'old', type: 'hello' });
  assert.equal(mismatch.type, 'error');
  if (mismatch.type === 'error') { assert.equal(mismatch.error.code, 'UNSUPPORTED_VERSION'); assert.match(mismatch.error.message, /Rebuild and reload/); }
});
test('UTF-8 encoded JSON cap includes escaping and protocol envelope', () => {
  for (const character of ['a', '世', '🐉', '\n', '"', '\ud800']) {
    const request = { version: 2, id: 'test', type: 'summary.start', transcript: character.repeat(MAX_FRAME_BYTES / 2) };
    assert.equal(fitsFrame(request), Buffer.byteLength(JSON.stringify(request)) <= MAX_FRAME_BYTES);
    const value = validateRequest(request);
    assert.equal(value.type, fitsFrame(request) ? 'summary.start' : 'error');
    if (value.type === 'error') assert.equal(value.error.code, 'INPUT_TOO_LARGE');
  }
  assert.equal(fitsFrame(undefined), false);
});
test('all response variants are validated without additional private fields', () => {
  const base = { version: 2, id: 'x' };
  const good = [handleRequest({ ...base, type: 'hello' }, host),
    { ...base, type: 'auth.status', connection: { connected: true, planEnabled: true } },
    { ...base, type: 'summary.progress', stage: 'checking' },
    { ...base, type: 'summary.progress', stage: 'summarising' },
    { ...base, type: 'summary.result', model: 'fixture-model', text: '<script>source as text</script>' },
    { ...base, type: 'summary.cancelled' }, { ...base, type: 'summary.cancel', targetId: 'other' },
    { ...base, type: 'error', error: { code: 'TIMEOUT', message: 'Retry.' } }];
  for (const response of good) { assert.equal(isResponse(response), true); assert.equal(isResponse({ ...response, credentials: 'secret' }), false); }
  for (const value of [null, { ...good[0], version: 1 }, { ...good[0], id: '' },
    { ...good[0], host: { ...host, pid: -1 } }, { ...good[0], host: { ...host, nodeVersion: 'v22.0.0' } },
    { ...base, type: 'auth.status', connection: { connected: false, planEnabled: true } },
    { ...base, type: 'summary.progress', stage: '50%' },
    { ...base, type: 'summary.result', model: 'fixture', text: ' ' },
    { ...base, type: 'summary.result', model: 'fixture', text: '世'.repeat(MAX_FRAME_BYTES) },
    { ...base, type: 'error', error: { code: 'provider_code', message: 'Unsafe' } }]) assert.equal(isResponse(value), false);
});
