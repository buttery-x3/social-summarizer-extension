import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../apps/helper/src/native/handle-request.ts';
import { HOST_NAME, isSuccessResponse } from '@social-summarizer/protocol';

const host = { name: HOST_NAME, pid: 42, nodeVersion: 'v24.15.0', platform: 'win32' };
test('hello/ping preserve version and request ID', () => {
  for (const type of ['hello', 'ping']) {
    const response = handleRequest({ version: 1, id: 'req-123', type }, host);
    assert.deepEqual(response, { version: 1, id: 'req-123', type: type === 'hello' ? 'hello' : 'pong', host });
    assert.ok(isSuccessResponse(response));
  }
});

test('invalid payloads and unsupported versions return bounded protocol errors', () => {
  for (const value of [null, [], 'hello', {}, { version: 1, id: '', type: 'hello' },
    { version: 1, id: 'x'.repeat(81), type: 'ping' }, { version: 1, id: 'x', type: 'exec' },
    { version: 1, id: 'x', type: 'ping', command: 'anything' }]) {
    const result = handleRequest(value, host);
    assert.equal(result.type, 'error');
    if (result.type === 'error') assert.equal(result.error.code, 'INVALID_REQUEST');
  }
  assert.deepEqual(handleRequest({ version: 2, id: 'v2', type: 'hello' }, host), {
    version: 1, id: 'v2', type: 'error', error: { code: 'UNSUPPORTED_VERSION', message: 'Expected protocol version 1.' }
  });
});

test('the extension rejects incompatible or malformed host responses', () => {
  const response = handleRequest({ version: 1, id: 'x', type: 'ping' }, host);
  assert.equal(isSuccessResponse(null), false);
  assert.equal(isSuccessResponse({ ...response, version: 2 }), false);
  assert.equal(isSuccessResponse({ ...response, id: '' }), false);
  assert.equal(isSuccessResponse({ ...response, host: { ...host, pid: -1 } }), false);
  assert.equal(isSuccessResponse({ ...response, host: { ...host, nodeVersion: 'v22.0.0' } }), false);
});
