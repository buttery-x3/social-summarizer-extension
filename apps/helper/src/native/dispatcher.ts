import { CAPABILITIES, PROTOCOL_VERSION, MODEL_TIMEOUT_MS, fitsFrame, isRecord, isResponse, protocolError, validateRequest,
  type ErrorCode, type HostInfo, type Response } from '@social-summarizer/protocol';
import type { SummaryBackend } from './backend.js';

// Fixed application messages only: never pass provider error text to the port.
export function safeError(id: string, error: unknown): Response {
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
  const status = isRecord(error) && typeof error.status === 'number' ? error.status : undefined;
  let safe: [ErrorCode, string] = ['HELPER_ERROR', 'The helper could not use ChatGPT. Check Node 24, the helper build and Windows credential storage, then retry.'];
  if (['sign_in_required', 'reauth_required', 'invalid_grant', 'connection_changed', 'invalid_refresh_token', 'token_expired',
    'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused', 'invalid_token', 'invalid_api_key'].includes(code) || status === 401) safe = ['SIGN_IN_REQUIRED', 'ChatGPT is signed out or needs reconnection. Run npm run chatgpt -- sign-in from the repository root, then retry.'];
  else if (['sharing_not_enabled', 'chatpass_v2_scope_not_authorized'].includes(code)) safe = ['PLAN_DISABLED', 'ChatGPT plan permission is disabled. Run npm run chatgpt -- sign-in --consent and allow plan use, then retry.'];
  else if (['model_not_found', 'no_models', 'model_not_available'].includes(code)) safe = ['MODEL_UNAVAILABLE', 'No usable model is available. Check npm run chatgpt -- models and your ChatGPT connection, then retry.'];
  else if (code.includes('usage_limit') || code === 'subscription_sharing_usage_unavailable' || status === 429) safe = ['USAGE_LIMIT', 'ChatGPT usage is unavailable or limited. Check app usage in ChatGPT settings and retry when available.'];
  else if (['network_error', 'refresh_not_ready', 'subscription_sharing_user_unavailable'].includes(code) || (status !== undefined && status >= 500)) safe = ['NETWORK_ERROR', 'Could not reach or renew the ChatGPT connection. Check your network and retry shortly.'];
  else if (['stream_interrupted', 'response_incomplete', 'empty_response', 'invalid_stream'].includes(code)) safe = ['INCOMPLETE_RESPONSE', 'ChatGPT did not complete a nonempty summary. Partial output was discarded. Retry when ready.'];
  else if (code === 'response_too_large') safe = ['OUTPUT_TOO_LARGE', 'The summary exceeds the 64 KiB UTF-8 JSON limit. Try a shorter conversation.'];
  else if (status === 403 || code.startsWith('subscription_sharing_') || code.startsWith('chatpass_v2_')) safe = ['HELPER_ERROR', 'ChatGPT rejected this account, app or permission context. Check your ChatGPT plan, app access and serving-region eligibility before retrying.'];
  return protocolError(id, ...safe);
}

type Operation = { id: string; controller: AbortController; timer: ReturnType<typeof setTimeout>; done: boolean; task: Promise<void> };
export class Dispatcher {
  private operations = new Map<string, Operation>();
  private summary: Operation | undefined;
  private closed = false;
  private host: HostInfo;
  private backend: SummaryBackend;
  private send: (response: Response) => void;
  private timeoutMs: number;
  constructor(host: HostInfo, backend: SummaryBackend, send: (response: Response) => void, timeoutMs = MODEL_TIMEOUT_MS) {
    this.host = host; this.backend = backend; this.send = send; this.timeoutMs = timeoutMs;
  }
  private emit(response: Response) {
    if (this.closed) return;
    if (!fitsFrame(response) && response.id) response = protocolError(response.id, 'OUTPUT_TOO_LARGE', 'The summary exceeds the 64 KiB UTF-8 JSON limit. Try a shorter conversation.');
    if (!isResponse(response)) throw new Error('Invalid outgoing native response.');
    this.send(response);
  }
  private finish(operation: Operation, response: Response) {
    if (operation.done || this.closed) return;
    if (!fitsFrame(response)) response = protocolError(operation.id, 'OUTPUT_TOO_LARGE', 'The summary exceeds the 64 KiB UTF-8 JSON limit. Try a shorter conversation.');
    else if (!isResponse(response)) response = protocolError(operation.id, 'HELPER_ERROR', 'The helper returned an invalid result. Rebuild the helper and explicitly retry.');
    operation.done = true;
    clearTimeout(operation.timer);
    this.emit(response);
    // Keep ID and busy slot until the SDK settles. Token rotation intentionally
    // persists before honouring abort, under its separate 60 second deadline.
  }
  accept(value: unknown): void {
    if (this.closed) return;
    if (isRecord(value) && typeof value.id === 'string' && this.operations.has(value.id)) {
      // Avoid a second terminal with the original ID: reject the duplicate as
      // an uncorrelated protocol error while the original operation continues.
      this.emit(protocolError(null, 'DUPLICATE_ID', 'An operation with this request ID is already in flight. Use a fresh ID.'));
      return;
    }
    const request = validateRequest(value);
    if (request.type === 'error') { this.emit(request); return; }
    if (request.type === 'hello' || request.type === 'ping') {
      this.emit({ version: PROTOCOL_VERSION, id: request.id, type: request.type === 'hello' ? 'hello' : 'pong', host: this.host, capabilities: CAPABILITIES });
      return;
    }
    if (request.type === 'summary.cancel') {
      const active = this.summary;
      if (!active || active.id !== request.targetId || active.done) {
        this.emit(protocolError(request.id, 'NOT_RUNNING', 'The targeted summary is no longer running.'));
        return;
      }
      active.controller.abort();
      this.finish(active, { version: PROTOCOL_VERSION, id: active.id, type: 'summary.cancelled' });
      this.emit({ version: PROTOCOL_VERSION, id: request.id, type: 'summary.cancel', targetId: request.targetId });
      return;
    }
    if (this.operations.size) {
      this.emit(protocolError(request.id, 'BUSY', 'The helper is still finishing an operation. Wait briefly, then explicitly retry.'));
      return;
    }
    const controller = new AbortController();
    const operation: Operation = { id: request.id, controller, done: false, task: Promise.resolve(),
      timer: setTimeout(() => {
        controller.abort();
        this.finish(operation, protocolError(operation.id, 'TIMEOUT', 'ChatGPT operation timed out. No successful summary was reported. Retry when ready.'));
      }, this.timeoutMs) };
    this.operations.set(operation.id, operation);
    if (request.type === 'summary.start') this.summary = operation;
    operation.task = (async () => {
      try {
        if (request.type === 'auth.status') {
          const connection = await this.backend.status(controller.signal);
          controller.signal.throwIfAborted();
          this.finish(operation, { version: PROTOCOL_VERSION, id: request.id, type: 'auth.status', connection });
        } else if (request.type === 'summary.start') {
          this.emit({ version: PROTOCOL_VERSION, id: request.id, type: 'summary.progress', stage: 'checking' });
          const result = await this.backend.summarise(request.transcript, controller.signal, () => {
            if (!operation.done && !controller.signal.aborted) this.emit({ version: PROTOCOL_VERSION, id: request.id, type: 'summary.progress', stage: 'summarising' });
          });
          controller.signal.throwIfAborted();
          if (!result.text.trim()) throw { code: 'empty_response' };
          this.finish(operation, { version: PROTOCOL_VERSION, id: request.id, type: 'summary.result', model: result.model, text: result.text });
        }
      } catch (error) {
        if (!operation.done) this.finish(operation, safeError(request.id, error));
      } finally {
        clearTimeout(operation.timer);
        this.operations.delete(operation.id);
        if (this.summary === operation) this.summary = undefined;
      }
    })();
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const operation of this.operations.values()) { clearTimeout(operation.timer); operation.controller.abort(); }
    await Promise.allSettled([...this.operations.values()].map(operation => operation.task));
  }
}
