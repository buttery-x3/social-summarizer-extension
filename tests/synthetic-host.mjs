// SYNTHETIC MODEL BOUNDARY. Real native frames, dispatcher, Windows client,
// pinned SDK streaming/completion and DPAPI; only provider fetch is synthetic.
// This entry is never used by the production registration or default npm test.
import assert from 'node:assert/strict';
import { readFile, appendFile } from 'node:fs/promises';
import { runHost } from '../dist/test-host/runtime.cjs';
import { createWindowsClient, summariseTranscript } from '../apps/helper/dist/chatgpt/client.js';
import { ConnectionStore } from '../apps/helper/vendor/devkit/packages/local/dist/storage.js';
import { createDpapiEncryption } from '../apps/helper/dist/chatgpt/dpapi.js';

const configPath = process.argv[2];
const config = async () => JSON.parse(await readFile(configPath, 'utf8'));
const initial = await config();
process.env.CHATGPT_SPIKE_STORAGE_DIR = initial.storage;
const client = await createWindowsClient();
const store = new ConnectionStore(initial.storage, createDpapiEncryption());
const audit = event => appendFile(initial.audit, JSON.stringify(event) + '\n');
async function seed(scenario) {
  await store.withLock(() => store.write({ version: 2, activeProfileId: scenario === 'signed-out' ? undefined : 'synthetic', pendingRegistrations: [],
    profiles: scenario === 'signed-out' ? [] : [{ version: 1, id: 'synthetic', label: 'Synthetic test only', clientId: 'synthetic_client',
      subject: 'synthetic-subject', status: 'connected', scopes: scenario === 'plan-disabled' ? ['openid'] : ['chatgpt.tokens.use.direct'],
      savedAt: new Date().toISOString(), credentials: { accessToken: 'synthetic-private-token', expiresAt: Date.now() + 3600_000 } }] }));
}
globalThis.fetch = async (url, options) => {
  const { scenario } = await config();
  if (String(url) === 'https://api.openai.com/v1/models') {
    if (scenario === 'network') throw new Error('synthetic-private-token network failure');
    return Response.json({ models: scenario === 'no-models' ? [] : [{ slug: 'synthetic-model', display_name: 'Synthetic model', visibility: 'list' }] });
  }
  assert.equal(String(url), 'https://api.openai.com/v1/responses', 'Synthetic test must never access a live endpoint');
  const body = JSON.parse(options.body);
  const text = body.input[0].content;
  await audit({ event: 'inference', scenario, text });
  const event = value => `data: ${JSON.stringify(value)}\n\n`;
  if (scenario === 'cancel' || scenario === 'timeout' || scenario === 'close' || scenario === 'kill') {
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(event({ type: 'response.output_text.delta', delta: 'Partial text never succeeds.' })));
        const abort = () => {
          void audit({ event: 'aborted', scenario });
          try { controller.close(); } catch {}
        };
        if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
  }
  if (scenario === 'usage') return new Response(event({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'synthetic-private-token' } } }), { headers: { 'content-type': 'text/event-stream' } });
  const summary = scenario === 'empty' ? '' : scenario === 'oversized' ? '世'.repeat(30_000) :
    `<script>window.syntheticExecuted = true</script>\nDecision: board-game night. Deadline: ${text.includes('Sunday') ? 'Sunday' : 'Thursday'}.`;
  const events = [event({ type: 'response.output_text.delta', delta: summary })];
  if (scenario === 'incomplete') events.push(event({ type: 'response.incomplete' }));
  else if (scenario !== 'interrupted') events.push(event({ type: 'response.completed' }));
  return new Response(events.join(''), { headers: { 'content-type': 'text/event-stream' } });
};
await runHost({
  async status(signal) {
    await seed((await config()).scenario);
    signal.throwIfAborted();
    const session = await client.getSession();
    return { connected: session.status === 'connected', planEnabled: session.sharing };
  },
  summarise: (text, signal, stage) => summariseTranscript(client, text, signal, undefined, stage),
}, initial.timeoutMs);
