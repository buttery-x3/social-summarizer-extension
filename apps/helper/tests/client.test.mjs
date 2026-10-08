import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createChatGPT } from '@siwc/local';
import { ConnectionStore } from '../vendor/devkit/packages/local/dist/storage.js';
import { createDpapiEncryption } from '../dist/chatgpt/dpapi.js';
import { prepareStorage } from '../dist/chatgpt/storage.js';
import { inventedTranscript, summariseInventedTranscript, summariseTranscript } from '../dist/chatgpt/client.js';

async function fixture(t, openBrowser = () => assert.fail('No browser expected')) {
  const directory = await mkdtemp(join(tmpdir(), 'chatgpt-client-test-'));
  t.after(async () => {
    assert.equal(directory.startsWith(join(tmpdir(), 'chatgpt-client-test-')), true);
    await rm(directory, { recursive: true, force: true });
  });
  await prepareStorage(directory);
  const encryption = createDpapiEncryption();
  const store = new ConnectionStore(directory, encryption);
  const client = createChatGPT({ appName: 'Synthetic Client Test', appId: 'synthetic-client-test',
    redirectPort: 0, storageDir: directory, credentialEncryption: encryption, sendHostId: true, openBrowser });
  return { store, client };
}

async function seed(store, sharing = true) {
  await store.withLock(() => store.write({ version: 2, activeProfileId: 'fixture-profile', pendingRegistrations: [], profiles: [{
    version: 1, id: 'fixture-profile', label: 'Fixture', clientId: 'fixture_client', subject: 'fixture-subject',
    status: 'connected', scopes: sharing ? ['chatgpt.tokens.use.direct'] : ['openid'], savedAt: new Date().toISOString(),
    credentials: { accessToken: 'synthetic-private-access', expiresAt: Date.now() + 3_600_000 },
  }] }));
}

test('invented summary uses discovered model and the minimal request; partial output never succeeds', async t => {
  const { store, client } = await fixture(t);
  await seed(store);
  let outcome = 'completed';
  let inferenceCalls = 0;
  let expectedTranscript = inventedTranscript;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url) === 'https://api.openai.com/v1/models') return Response.json({ models: [
      { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' },
      { slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' },
    ] });
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    inferenceCalls++;
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'instructions', 'model', 'store', 'stream']);
    assert.equal(body.model, 'fixture-model');
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.deepEqual(body.input, [{ role: 'user', content: expectedTranscript }]);
    assert.match(body.instructions, /source material/);
    const events = [{ type: 'response.output_text.delta', delta: outcome === 'empty' ? '' : 'Synthetic summary.' }];
    if (outcome === 'completed' || outcome === 'empty') events.push({ type: 'response.completed' });
    if (outcome === 'failed') events.push({ type: 'response.failed', response: { error: {
      code: 'subscription_sharing_usage_limit_exceeded', message: 'synthetic-private-access must not appear in errors',
    } } });
    if (outcome === 'incomplete') events.push({ type: 'response.incomplete' });
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'content-type': 'text/event-stream' },
    });
  });
  assert.deepEqual(await summariseInventedTranscript(client, AbortSignal.timeout(5000)), {
    model: 'fixture-model', text: 'Synthetic summary.',
  });
  expectedTranscript = inventedTranscript.replaceAll('Thursday', 'Sunday');
  assert.deepEqual(await summariseTranscript(client, expectedTranscript, AbortSignal.timeout(5000)), { model: 'fixture-model', text: 'Synthetic summary.' });
  expectedTranscript = inventedTranscript;
  for (const [mode, code] of [['interrupted', 'stream_interrupted'], ['failed', 'subscription_sharing_usage_limit_exceeded'],
    ['incomplete', 'response_incomplete'], ['empty', 'empty_response']]) {
    outcome = mode;
    await assert.rejects(summariseInventedTranscript(client, AbortSignal.timeout(5000)), error => {
      assert.equal(error.code, code);
      assert.equal(JSON.stringify(error).includes('synthetic-private-access'), false);
      return true;
    });
  }
  const previousCalls = inferenceCalls;
  await assert.rejects(summariseInventedTranscript(client, AbortSignal.timeout(5000), 'hidden'), { code: 'model_not_found' });
  assert.equal(inferenceCalls, previousCalls);
});

test('missing sign-in or plan permission never reaches inference', async t => {
  const { store, client } = await fixture(t);
  t.mock.method(globalThis, 'fetch', () => assert.fail('No network without plan permission'));
  await assert.rejects(summariseInventedTranscript(client, AbortSignal.timeout(5000)), { code: 'sign_in_required' });
  await seed(store, false);
  await assert.rejects(summariseInventedTranscript(client, AbortSignal.timeout(5000)), { code: 'sharing_not_enabled' });
});

test('real loopback listener rejects wrong state, handles denied consent, closes, and reuses host ID', async t => {
  const nativeFetch = globalThis.fetch;
  let callback;
  let hostId;
  const { client } = await fixture(t, async authorization => {
    const url = new URL(authorization);
    const currentHost = url.searchParams.get('ext_agent_host_id');
    if (hostId) assert.equal(currentHost, hostId);
    else hostId = currentHost;
    assert.match(hostId, /^urn:uuid:/);
    assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'), true);
    callback = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    assert.equal(callback.pathname, '/auth/callback');
    callback.searchParams.set('error', 'access_denied');
    callback.searchParams.set('state', 'incorrect-state');
    assert.equal((await nativeFetch(callback)).status, 400);
    callback.searchParams.set('state', url.searchParams.get('state'));
    assert.equal((await nativeFetch(callback)).status, 200);
  });
  t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://auth.openai.com/.well-known/openid-configuration');
    return Response.json({ issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/authorize',
      token_endpoint: 'https://auth.openai.com/token', jwks_uri: 'https://auth.openai.com/jwks' });
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(client.signIn(), { code: 'access_denied' });
    await assert.rejects(nativeFetch(callback));
    assert.equal((await client.getSession()).status, 'disconnected');
  }
});

test('cancellation and timeout stop an open callback listener without success', async t => {
  const nativeFetch = globalThis.fetch;
  for (const mode of ['cancel', 'timeout']) {
    let callback;
    const controller = new AbortController();
    const { client } = await fixture(t, authorization => {
      callback = new URL(new URL(authorization).searchParams.get('redirect_uri'));
      if (mode === 'cancel') controller.abort();
    });
    const signal = mode === 'cancel' ? controller.signal : AbortSignal.timeout(200);
    await assert.rejects(client.signIn({ signal }), { code: 'cancelled' });
    await delay(10);
    await assert.rejects(nativeFetch(callback));
    assert.equal((await client.getSession()).status, 'disconnected');
  }
});
