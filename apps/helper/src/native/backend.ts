import type { ConnectionStatus } from '@social-summarizer/protocol';

export interface SummaryBackend {
  status(signal: AbortSignal): Promise<ConnectionStatus>;
  summarise(transcript: string, signal: AbortSignal, onSummarising: () => void): Promise<{ model: string; text: string }>;
}

export function windowsBackend(): SummaryBackend {
  // Resolve relative to dist/host/index.cjs at runtime. Keep this ESM import out
  // of the CJS bundle: SDK and native DPAPI resolve from apps/helper/dist.
  // hello/ping never import or initialise the client.
  const modulePath = '../../apps/helper/dist/chatgpt/client.js';
  let loaded: Promise<{ module: typeof import('../chatgpt/client.js'); client: Awaited<ReturnType<typeof import('../chatgpt/client.js').createWindowsClient>> }> | undefined;
  const load = () => loaded ??= (async () => {
    const module = await import(modulePath) as typeof import('../chatgpt/client.js');
    const client = await module.createWindowsClient();
    return { module, client };
  })().catch(error => { loaded = undefined; throw error; });
  return {
    async status(signal) {
      const { client } = await load();
      signal.throwIfAborted();
      const session = await client.getSession();
      signal.throwIfAborted();
      return { connected: session.status === 'connected', planEnabled: session.status === 'connected' && session.sharing };
    },
    async summarise(transcript, signal, onSummarising) {
      const { module, client } = await load();
      signal.throwIfAborted();
      return module.summariseTranscript(client, transcript, signal, undefined, onSummarising);
    },
  };
}
