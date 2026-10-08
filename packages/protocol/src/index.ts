export const HOST_NAME = 'com.flamehorn.social_summarizer_spike';
export const PROTOCOL_VERSION = 2;
export const MAX_FRAME_BYTES = 64 * 1024;
export const MODEL_TIMEOUT_MS = 180_000;
export const CAPABILITIES = ['auth.status', 'summary.start', 'summary.cancel'] as const;

export type Request = { version: 2; id: string } & (
  { type: 'hello' | 'ping' | 'auth.status' } |
  { type: 'summary.start'; transcript: string } |
  { type: 'summary.cancel'; targetId: string }
);
export type HostInfo = { name: string; pid: number; nodeVersion: string; platform: string };
export type SuccessResponse = {
  version: 2; id: string; type: 'hello' | 'pong'; host: HostInfo; capabilities: typeof CAPABILITIES;
};
export type ConnectionStatus = { connected: boolean; planEnabled: boolean };
export const ERROR_CODES = ['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'INPUT_TOO_LARGE', 'OUTPUT_TOO_LARGE',
  'DUPLICATE_ID', 'BUSY', 'NOT_RUNNING', 'SIGN_IN_REQUIRED', 'PLAN_DISABLED', 'MODEL_UNAVAILABLE',
  'USAGE_LIMIT', 'NETWORK_ERROR', 'INCOMPLETE_RESPONSE', 'TIMEOUT', 'HELPER_ERROR'] as const;
export type ErrorCode = typeof ERROR_CODES[number];
export type ErrorResponse = {
  version: 2; id: string | null; type: 'error'; error: { code: ErrorCode; message: string };
};
export type Response = SuccessResponse | ErrorResponse | ({ version: 2; id: string } & (
  { type: 'auth.status'; connection: ConnectionStatus } |
  { type: 'summary.progress'; stage: 'checking' | 'summarising' } |
  { type: 'summary.result'; model: string; text: string } |
  { type: 'summary.cancelled' } |
  { type: 'summary.cancel'; targetId: string }
));

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}
function keys(value: Record<string, unknown>, expected: string): boolean {
  return Object.keys(value).sort().join(',') === expected;
}
// JSON escaping and UTF-8 bytes both count toward the cap, in browser and host.
export function fitsFrame(value: unknown): boolean {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return false;
    let bytes = 0;
    for (const character of json) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      if (bytes > MAX_FRAME_BYTES) return false;
    }
    return true;
  }
  catch { return false; }
}
export function protocolError(id: string | null, code: ErrorCode, message: string): ErrorResponse {
  return { version: PROTOCOL_VERSION, id, type: 'error', error: { code, message } };
}
export function validateRequest(value: unknown): Request | ErrorResponse {
  const id = isRecord(value) && validId(value.id) ? value.id : null;
  const invalid = (message: string) => protocolError(id, 'INVALID_REQUEST', message);
  if (!isRecord(value) || !validId(value.id)) return invalid('Expected a request ID with 1-80 safe characters.');
  if (value.version !== PROTOCOL_VERSION) return protocolError(id, 'UNSUPPORTED_VERSION',
    `Expected protocol version ${PROTOCOL_VERSION}. Rebuild and reload the extension and helper together.`);
  if (!fitsFrame(value)) return protocolError(id, 'INPUT_TOO_LARGE', 'Request exceeds the 64 KiB UTF-8 JSON limit. Use a shorter transcript.');
  if (value.type === 'summary.start') {
    if (!keys(value, 'id,transcript,type,version') || typeof value.transcript !== 'string' || !value.transcript.trim()) {
      return invalid('Provide a nonempty transcript and only version, id, type and transcript.');
    }
    return { version: PROTOCOL_VERSION, id: value.id, type: value.type, transcript: value.transcript };
  }
  if (value.type === 'summary.cancel') {
    if (!keys(value, 'id,targetId,type,version') || !validId(value.targetId) || value.targetId === value.id) {
      return invalid('Cancellation requires a different valid target request ID.');
    }
    return { version: PROTOCOL_VERSION, id: value.id, type: value.type, targetId: value.targetId };
  }
  if (!keys(value, 'id,type,version') || !['hello', 'ping', 'auth.status'].includes(String(value.type))) {
    return invalid('Expected only version, id and a supported operation.');
  }
  return { version: PROTOCOL_VERSION, id: value.id, type: value.type as 'hello' | 'ping' | 'auth.status' };
}

export function isResponse(value: unknown): value is Response {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || !fitsFrame(value)) return false;
  if (value.type === 'error') return (value.id === null || validId(value.id)) && keys(value, 'error,id,type,version') &&
    isRecord(value.error) && keys(value.error, 'code,message') && ERROR_CODES.includes(value.error.code as ErrorCode) &&
    typeof value.error.message === 'string' && value.error.message.length > 0 && value.error.message.length <= 500;
  if (!validId(value.id)) return false;
  if (value.type === 'hello' || value.type === 'pong') {
    if (!keys(value, 'capabilities,host,id,type,version') || !isRecord(value.host) ||
      !keys(value.host, 'name,nodeVersion,pid,platform') || JSON.stringify(value.capabilities) !== JSON.stringify(CAPABILITIES)) return false;
    const host = value.host;
    return host.name === HOST_NAME && Number.isSafeInteger(host.pid) && (host.pid as number) > 0 &&
      typeof host.nodeVersion === 'string' && /^v24\./.test(host.nodeVersion) && host.platform === 'win32';
  }
  if (value.type === 'auth.status') return keys(value, 'connection,id,type,version') && isRecord(value.connection) &&
    keys(value.connection, 'connected,planEnabled') && typeof value.connection.connected === 'boolean' &&
    typeof value.connection.planEnabled === 'boolean' && (!value.connection.planEnabled || value.connection.connected);
  if (value.type === 'summary.progress') return keys(value, 'id,stage,type,version') && ['checking', 'summarising'].includes(String(value.stage));
  if (value.type === 'summary.result') return keys(value, 'id,model,text,type,version') &&
    typeof value.model === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value.model) && typeof value.text === 'string' && !!value.text.trim();
  if (value.type === 'summary.cancelled') return keys(value, 'id,type,version');
  if (value.type === 'summary.cancel') return keys(value, 'id,targetId,type,version') && validId(value.targetId) && value.id !== value.targetId;
  return false;
}
export function isSuccessResponse(value: unknown): value is SuccessResponse {
  return isResponse(value) && (value.type === 'hello' || value.type === 'pong');
}
