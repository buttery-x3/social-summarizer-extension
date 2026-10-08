export const HOST_NAME = 'com.flamehorn.social_summarizer_spike';
export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 64 * 1024;

export type Request = { version: 1; id: string; type: 'hello' | 'ping' };
export type HostInfo = { name: string; pid: number; nodeVersion: string; platform: string };
export type SuccessResponse = {
  version: 1; id: string; type: 'hello' | 'pong'; host: HostInfo;
};
export type ErrorResponse = {
  version: 1; id: string | null; type: 'error';
  error: { code: 'INVALID_REQUEST' | 'UNSUPPORTED_VERSION'; message: string };
};
export type Response = SuccessResponse | ErrorResponse;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

export function handleRequest(value: unknown, host: HostInfo): Response {
  const id = isRecord(value) && validId(value.id) ? value.id : null;
  const invalid = (code: ErrorResponse['error']['code'], message: string): ErrorResponse =>
    ({ version: PROTOCOL_VERSION, id, type: 'error', error: { code, message } });
  if (!isRecord(value) || !validId(value.id) ||
      Object.keys(value).sort().join(',') !== 'id,type,version' ||
      (value.type !== 'hello' && value.type !== 'ping')) {
    return invalid('INVALID_REQUEST', 'Expected only version, id (1-80 safe characters), and type (hello or ping).');
  }
  if (value.version !== PROTOCOL_VERSION) {
    return invalid('UNSUPPORTED_VERSION', `Expected protocol version ${PROTOCOL_VERSION}.`);
  }
  return { version: PROTOCOL_VERSION, id: value.id,
    type: value.type === 'hello' ? 'hello' : 'pong', host };
}

export function isSuccessResponse(value: unknown): value is SuccessResponse {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || !validId(value.id) ||
      (value.type !== 'hello' && value.type !== 'pong') || !isRecord(value.host)) return false;
  const host = value.host;
  return host.name === HOST_NAME && Number.isSafeInteger(host.pid) && (host.pid as number) > 0 &&
    typeof host.nodeVersion === 'string' && /^v24\./.test(host.nodeVersion) && host.platform === 'win32';
}
