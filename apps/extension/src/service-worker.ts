import { HOST_NAME, PROTOCOL_VERSION, MODEL_TIMEOUT_MS, isRecord, isResponse, validateRequest,
  type Response, type Request, type ConnectionStatus, type SuccessResponse } from '@social-summarizer/protocol';

export type PageStatus = {
  state: string; detail: string; helperConnected: boolean; connection: ConnectionStatus | null;
  busy: boolean; summary?: { model: string; text: string }; response?: SuccessResponse;
};
type Pending = { expected: Response['type']; resolve: (value: Response) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const HANDSHAKE_TIMEOUT_MS = 5000;

chrome.action.onClicked.addListener(() => { void chrome.tabs.create({ url: chrome.runtime.getURL('test.html') }); });
// One page owns one port/host. No model work starts from a toolbar click or load.
chrome.runtime.onConnect.addListener((ui) => {
  if (ui.name !== 'helper-test' || ui.sender?.id !== chrome.runtime.id || ui.sender?.url !== chrome.runtime.getURL('test.html')) {
    ui.disconnect(); return;
  }
  let native: chrome.runtime.Port | null = null;
  let closed = false;
  let generation = 0;
  let busy = false;
  let connection: ConnectionStatus | null = null;
  let operation: { generation: number; id?: string; cancelled: boolean } | null = null;
  let status: PageStatus = { state: 'disconnected', detail: 'Ready. Click Test helper connection or Summarise test conversation.', helperConnected: false, connection, busy };
  const pending = new Map<string, Pending>();
  const publish = (state: string, detail: string, extra: Partial<PageStatus> = {}) => {
    status = { state, detail, helperConnected: native !== null, connection, busy, ...extra };
    if (!closed) ui.postMessage(status);
  };
  const closeNative = (reason: string) => {
    generation++;
    const previous = native;
    native = null;
    connection = null;
    operation = null;
    busy = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(reason)); }
    pending.clear();
    previous?.disconnect();
  };
  const fail = (detail: string) => { closeNative(detail); publish('error', detail); };
  const connect = () => {
    const port = chrome.runtime.connectNative(HOST_NAME);
    native = port;
    port.onMessage.addListener((value: unknown) => {
      if (native !== port || closed) return;
      if (!isResponse(value)) {
        fail('Helper returned an invalid response or incompatible protocol/runtime. Rebuild and reload the extension and helper together.'); return;
      }
      const request = value.id ? pending.get(value.id) : undefined;
      // A terminal from a completed/cancelled request or old connection is stale.
      if (!request) return;
      if (value.type === 'summary.progress') {
        if (request.expected !== 'summary.result') { fail('Unexpected helper progress. Reconnect and retry.'); return; }
        if (!operation?.cancelled) publish(value.stage === 'checking' ? 'checking' : 'summarising',
          value.stage === 'checking' ? 'Checking ChatGPT connection and available model…' : 'Summarising conversation…');
        return;
      }
      if (value.type !== request.expected && value.type !== 'error' &&
        !(request.expected === 'summary.result' && value.type === 'summary.cancelled')) {
        fail('Helper response did not match the pending operation. Reconnect and retry.'); return;
      }
      clearTimeout(request.timer);
      pending.delete(value.id!);
      request.resolve(value);
    });
    port.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message ?? '';
      if (native !== port) return;
      if (/not found/i.test(message)) fail('Helper is not registered. Run scripts/register-host.ps1 from the repository root, then retry.');
      else if (/forbidden/i.test(message)) fail('Extension ID is not allowed. Check the manifest key and re-register the helper.');
      else if (/failed to start/i.test(message)) fail('Helper could not start. Check Node 24, then rebuild and re-register.');
      else fail('Helper disconnected unexpectedly. Click Test helper connection to start a fresh helper, then explicitly retry.');
    });
  };
  const request = (payload: Request, expected: Response['type'], timeoutMs: number): Promise<Response> => new Promise((resolve, reject) => {
    const valid = validateRequest(payload);
    if (valid.type === 'error') { reject(new Error(valid.error.message)); return; }
    const timer = setTimeout(() => fail(expected === 'hello' || expected === 'pong' || expected === 'summary.cancel'
      ? 'Helper did not respond within 5 seconds. Connection closed; retry when ready.'
      : 'ChatGPT operation timed out. Connection closed; no successful summary was reported. Retry when ready.'), timeoutMs);
    pending.set(payload.id, { expected, resolve, reject, timer });
    try {
      if (!native) throw new Error('Helper is disconnected.');
      native.postMessage(payload);
    } catch { fail('Could not send to the helper. Reconnect and explicitly retry.'); }
  });
  const simple = (type: 'hello' | 'ping' | 'auth.status', expected: Response['type']) => request({ version: PROTOCOL_VERSION, id: crypto.randomUUID(), type }, expected,
    type === 'auth.status' ? MODEL_TIMEOUT_MS + HANDSHAKE_TIMEOUT_MS : HANDSHAKE_TIMEOUT_MS);
  const check = (response: Response) => {
    if (response.type === 'error') throw new Error(response.error.message);
    return response;
  };
  ui.onMessage.addListener((message: unknown) => {
    if (!isRecord(message)) return;
    if (message.action === 'disconnect') {
      closeNative('Disconnected by the test page.');
      publish('disconnected', 'Disconnected. The helper input is closed; you can connect again.'); return;
    }
    if (message.action === 'cancel') {
      if (!operation || operation.cancelled) return;
      operation.cancelled = true;
      if (!operation.id) {
        closeNative('Cancelled before inference.'); publish('cancelled', 'Cancelled. No successful summary was reported.'); return;
      }
      publish('cancelling', 'Cancelling summary…');
      // Start/cancel use distinct IDs. Ignore a result racing with this click.
      void request({ version: PROTOCOL_VERSION, id: crypto.randomUUID(), type: 'summary.cancel', targetId: operation.id }, 'summary.cancel', HANDSHAKE_TIMEOUT_MS).catch(() => {});
      return;
    }
    if (!['test', 'status', 'summary'].includes(String(message.action)) || busy) return;
    if (message.action === 'summary' && typeof message.transcript !== 'string') return;
    if (message.action === 'summary') {
      const valid = validateRequest({ version: PROTOCOL_VERSION, id: crypto.randomUUID(), type: 'summary.start', transcript: message.transcript });
      if (valid.type === 'error') { publish('failed', valid.error.message); return; }
    }
    busy = true;
    const current = { generation, cancelled: false, id: undefined as string | undefined };
    operation = current;
    const alive = () => !closed && current.generation === generation && operation === current;
    void (async () => {
      try {
        if (!native) {
          publish('connecting', 'Starting helper and sending hello…');
          connect(); check(await simple('hello', 'hello'));
        }
        if (!alive()) return;
        if (message.action === 'test') {
          const response = check(await simple('ping', 'pong')) as SuccessResponse;
          if (alive()) { busy = false; publish('connected', `Ping passed. Protocol ${response.version}; matching request ID ${response.id}.`, { response }); }
          return;
        }
        publish('checking', 'Checking saved ChatGPT connection…');
        const auth = check(await simple('auth.status', 'auth.status'));
        if (!alive() || auth.type !== 'auth.status') return;
        connection = auth.connection;
        if (!connection.connected) throw new Error('ChatGPT is signed out. Run npm run chatgpt -- sign-in from the repository root, then click Check ChatGPT connection or retry.');
        if (!connection.planEnabled) throw new Error('ChatGPT plan permission is disabled. Run npm run chatgpt -- sign-in --consent and allow plan use, then retry.');
        if (message.action === 'status') { busy = false; publish('connected', 'ChatGPT connected with plan permission. Ready for an explicit summary request.'); return; }
        if (current.cancelled) return;
        current.id = crypto.randomUUID();
        const response = await request({ version: PROTOCOL_VERSION, id: current.id, type: 'summary.start', transcript: message.transcript as string }, 'summary.result', MODEL_TIMEOUT_MS + HANDSHAKE_TIMEOUT_MS);
        if (!alive()) return;
        busy = false;
        if (current.cancelled || response.type === 'summary.cancelled') { publish('cancelled', 'Cancelled. No successful summary was reported.'); return; }
        check(response);
        if (response.type === 'summary.result') publish('completed', 'Completed summary.', { summary: { model: response.model, text: response.text } });
      } catch (error) {
        if (alive()) { busy = false; publish('failed', error instanceof Error ? error.message : 'Operation failed. Explicitly retry when ready.'); }
      } finally {
        if (alive()) { busy = false; operation = null; }
      }
    })();
  });
  ui.onDisconnect.addListener(() => { closed = true; closeNative('Test page closed.'); });
  ui.postMessage(status);
});
