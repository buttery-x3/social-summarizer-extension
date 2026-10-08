import { PROTOCOL_VERSION, validateRequest } from '@social-summarizer/protocol';
import type { HostInfo, Response } from '@social-summarizer/protocol';

export function handleRequest(value: unknown, host: HostInfo): Response {
  const request = validateRequest(value);
  if (request.type === 'error') return request;
  return { version: PROTOCOL_VERSION, id: request.id,
    type: request.type === 'hello' ? 'hello' : 'pong', host };
}
