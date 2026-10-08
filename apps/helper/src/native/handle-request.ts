import { CAPABILITIES, PROTOCOL_VERSION, protocolError, validateRequest } from '@social-summarizer/protocol';
import type { HostInfo, Response } from '@social-summarizer/protocol';

export function handleRequest(value: unknown, host: HostInfo): Response {
  const request = validateRequest(value);
  if (request.type === 'error') return request;
  if (request.type !== 'hello' && request.type !== 'ping') return protocolError(request.id, 'INVALID_REQUEST', 'This operation requires the asynchronous dispatcher.');
  return { version: PROTOCOL_VERSION, id: request.id,
    type: request.type === 'hello' ? 'hello' : 'pong', host, capabilities: CAPABILITIES };
}
