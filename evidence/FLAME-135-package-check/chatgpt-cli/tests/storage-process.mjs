// Synthetic fixture operations only. Never use this runner with a live data directory.
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createChatGPT } from '@siwc/local';
import { ConnectionStore } from '../vendor/devkit/packages/local/dist/storage.js';
import { createDpapiEncryption } from '../dist/dpapi.js';
import { prepareStorage } from '../dist/storage.js';

const [operation, directory] = process.argv.slice(2);
const provider = createDpapiEncryption();
assert.equal(await provider.isAvailable(), true);
const store = new ConnectionStore(directory, provider);
const client = createChatGPT({ appName: 'Synthetic Storage Test', appId: 'synthetic-storage-test',
  redirectPort: 0, storageDir: directory, credentialEncryption: provider,
  openBrowser: () => assert.fail('Fixture must never open a browser') });

if (operation === 'seed' || operation === 'seed-expiring') {
  await prepareStorage(directory);
  await store.withLock(async () => {
    await store.getHostId();
    await store.write({ version: 2, activeProfileId: 'fixture-profile', pendingRegistrations: [], profiles: [{
      version: 1, id: 'fixture-profile', label: 'Fixture', clientId: 'fixture_client', subject: 'fixture-subject',
      identity: { email: 'fixture@example.invalid' }, profileIdToken: 'fixture-private-id-token',
      status: 'connected', scopes: ['openid', 'offline_access', 'chatgpt.tokens.use.direct'], savedAt: new Date().toISOString(),
      credentials: { accessToken: 'fixture-private-access', refreshToken: 'fixture-private-refresh',
        expiresAt: Date.now() + (operation === 'seed-expiring' ? 30_000 : 3_600_000) },
    }] });
  });
  console.log('Synthetic connection encrypted.');
} else if (operation === 'read') {
  const session = await client.getSession();
  assert.equal(session.status, 'connected');
  assert.equal(session.sharing, true);
  const saved = await store.withLock(() => store.read());
  assert.equal(saved.profiles[0].credentials.accessToken, 'fixture-private-access');
  console.log('Synthetic connection restored in a new process.');
} else if (operation === 'clear' || operation === 'clear-offline') {
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/authorize',
      token_endpoint: 'https://auth.openai.com/token', jwks_uri: 'https://auth.openai.com/jwks',
      revocation_endpoint: 'https://auth.openai.com/revoke',
    });
    assert.equal(url, 'https://auth.openai.com/revoke');
    assert.equal(options.body.get('token'), 'fixture-private-refresh');
    if (operation === 'clear-offline') throw new Error('Synthetic offline');
    return new Response(null, { status: 200 });
  };
  if (operation === 'clear-offline') await assert.rejects(client.disconnect(), { code: 'revocation_failed' });
  else await client.disconnect();
  console.log('Synthetic local tokens cleared.');
} else if (operation === 'assert-cleared') {
  assert.equal((await client.getSession()).status, 'disconnected');
  await assert.rejects(client.listModels(), { code: 'sign_in_required' });
  const saved = await store.withLock(() => store.read());
  assert.equal(saved.profiles[0].clientId, 'fixture_client');
  for (const key of ['credentials', 'profileIdToken', 'pendingRefresh']) assert.equal(key in saved.profiles[0], false);
  console.log('Restart requires sign-in; encrypted registration retained.');
} else if (operation === 'assert-corrupt') {
  const session = await client.getSession();
  assert.equal(session.status, 'reauth_required');
  assert.equal(session.sharing, false);
  assert.equal(session.error.code, 'storage_decryption_failed');
  await assert.rejects(client.signIn(), { code: 'storage_decryption_failed' });
  console.log('Corrupt ciphertext rejected before sign-in.');
} else if (operation === 'refresh') {
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/.well-known/openid-configuration')) return Response.json({
      issuer: 'https://auth.openai.com', authorization_endpoint: 'https://auth.openai.com/authorize',
      token_endpoint: 'https://auth.openai.com/token', jwks_uri: 'https://auth.openai.com/jwks',
    });
    if (url === 'https://auth.openai.com/token') {
      assert.equal(options.body.get('refresh_token'), 'fixture-private-refresh');
      assert.equal(options.body.get('client_id'), 'fixture_client');
      assert.equal(options.body.get('grant_type'), 'refresh_token');
      await appendFile(join(directory, 'synthetic-refresh-count'), '1\n');
      await delay(200);
      return Response.json({ access_token: 'fixture-successor-access', refresh_token: 'fixture-successor-refresh',
        expires_in: 3600, token_type: 'Bearer' });
    }
    assert.equal(url, 'https://api.openai.com/v1/models');
    assert.equal(options.headers.authorization, 'Bearer fixture-successor-access');
    return Response.json({ models: [{ slug: 'fixture-model', display_name: 'Fixture model', visibility: 'list' }] });
  };
  assert.equal((await client.listModels())[0].slug, 'fixture-model');
  console.log('Request used the serialized synthetic rotation.');
} else {
  throw new Error('Unknown synthetic test operation');
}
