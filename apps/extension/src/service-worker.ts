import { HOST_NAME, PROTOCOL_VERSION, isRecord, isSuccessResponse, type SuccessResponse } from '@social-summarizer/protocol';

type Status = { state: 'disconnected' | 'connecting' | 'connected' | 'error'; detail: string; response?: SuccessResponse };
type Pending = { type: 'hello' | 'pong'; resolve: (value: SuccessResponse) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const TIMEOUT_MS = 5000;

// Each test page owns its connection. Closing/reloading the page closes the host.
chrome.runtime.onConnect.addListener((ui) => {
  if (ui.name !== 'helper-test' || ui.sender?.id !== chrome.runtime.id ||
      ui.sender?.url !== chrome.runtime.getURL('test.html')) {
    ui.disconnect();
    return;
  }
  let native: chrome.runtime.Port | null = null;
  let status: Status = { state: 'disconnected', detail: 'Ready. The helper starts when you click Test helper connection.' };
  let busy = false;
  let closed = false;
  const pending = new Map<string, Pending>();
  const publish = (next: Status) => {
    status = next;
    if (!closed) ui.postMessage(status);
  };
  const closeNative = (reason: string) => {
    const previous = native;
    native = null;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(reason));
    }
    pending.clear();
    previous?.disconnect();
  };
  const fail = (detail: string) => {
    closeNative(detail);
    publish({ state: 'error', detail });
  };
  const describeDisconnect = (message: string) => {
    if (/not found/i.test(message)) return `Helper is not registered. Run scripts/register-host.ps1, then try again. Chrome: ${message}`;
    if (/forbidden/i.test(message)) return `This extension ID is not allowed. Check the manifest key and re-register. Chrome: ${message}`;
    if (/failed to start/i.test(message)) return `Helper could not start. Check Node 24 and rebuild/re-register. Chrome: ${message}`;
    return `Helper disconnected unexpectedly. Click Test helper connection to start a fresh helper. Chrome: ${message}`;
  };
  const connect = () => {
    const port = chrome.runtime.connectNative(HOST_NAME);
    native = port;
    port.onMessage.addListener((value: unknown) => {
      if (native !== port) return;
      if (!isSuccessResponse(value)) {
        fail(`Helper returned an invalid response or unsupported protocol/runtime: ${JSON.stringify(value)}`);
        return;
      }
      const request = pending.get(value.id);
      if (!request || value.type !== request.type) {
        fail('Helper response did not match the pending request ID/type. Try a fresh connection.');
        return;
      }
      clearTimeout(request.timer);
      pending.delete(value.id);
      request.resolve(value);
    });
    port.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message ?? 'Native host has exited.';
      if (native === port) fail(describeDisconnect(message));
    });
  };
  const request = (type: 'hello' | 'ping'): Promise<SuccessResponse> => new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => fail('Helper did not respond within 5 seconds. Connection closed; click Test helper connection to retry.'), TIMEOUT_MS);
    pending.set(id, { type: type === 'hello' ? 'hello' : 'pong', resolve, reject, timer });
    try {
      if (!native) throw new Error('Helper is disconnected.');
      native.postMessage({ version: PROTOCOL_VERSION, id, type });
    } catch (error) {
      fail(`Could not send to helper: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ui.onMessage.addListener((message: unknown) => {
    if (!isRecord(message) || Object.keys(message).length !== 1) return;
    if (message.action === 'disconnect') {
      closeNative('Disconnected by the test page.');
      publish({ state: 'disconnected', detail: 'Disconnected. The helper input is closed; you can connect again.' });
      return;
    }
    if (message.action !== 'test' || busy) return;
    busy = true;
    void (async () => {
      try {
        if (!native) {
          publish({ state: 'connecting', detail: 'Starting helper and sending hello…' });
          connect();
          const hello = await request('hello');
          publish({ state: 'connected', detail: `Hello received; protocol ${hello.version}, request ${hello.id}. Sending ping…`, response: hello });
        }
        const pong = await request('ping');
        publish({ state: 'connected', detail: `Ping passed. Protocol ${pong.version}; matching request ID ${pong.id}.`, response: pong });
      } catch (error) {
        // Disconnect/close may have deliberately cancelled an in-flight request.
        if (!closed && status.state !== 'disconnected' && status.state !== 'error')
          fail(error instanceof Error ? error.message : String(error));
      } finally {
        busy = false;
      }
    })();
  });
  ui.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    closed = true;
    closeNative('Test page closed.');
  });
  publish(status);
});
