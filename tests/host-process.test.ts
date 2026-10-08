import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FrameDecoder, encodeFrame } from '../apps/helper/src/native/framing.ts';
import { HOST_NAME, MAX_FRAME_BYTES, CAPABILITIES } from '@social-summarizer/protocol';

const entry = fileURLToPath(new URL('../dist/host/index.cjs', import.meta.url));
async function runHost(chunks: Buffer[]) {
  const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const complete = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  // Host may reject a header and close stdin before an outstanding write finishes.
  child.stdin.on('error', () => {});
  for (const chunk of chunks) child.stdin.write(chunk);
  child.stdin.end();
  const code = await complete;
  clearTimeout(timeout);
  return { code, pid: child.pid, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') };
}

test('real Node subprocess responds to consecutive requests and exits on EOF', async () => {
  const input = Buffer.concat(['hello', 'ping'].map((type) => encodeFrame({ version: 2, id: type, type })));
  const result = await runHost([...input].map((byte) => Buffer.from([byte])));
  assert.equal(result.code, 0);
  const decoder = new FrameDecoder();
  const responses = decoder.push(result.stdout);
  decoder.finish();
  assert.deepEqual(responses, ['hello', 'pong'].map((type, index) => ({
    version: 2, id: index === 0 ? 'hello' : 'ping', type,
    host: { name: HOST_NAME, pid: result.pid, nodeVersion: process.version, platform: process.platform }, capabilities: CAPABILITIES
  })));
  assert.match(result.stderr, /input closed; exiting/);
});

test('real Node subprocess reports request validation errors without corrupting stdout', async () => {
  const result = await runHost([encodeFrame({ version: 2, id: 'bad', type: 'exec' }),
    encodeFrame({ version: 2, id: 'good', type: 'ping' })]);
  assert.equal(result.code, 0);
  const responses = new FrameDecoder().push(result.stdout) as { type: string; id: string }[];
  assert.deepEqual(responses.map(({ type, id }) => ({ type, id })), [{ type: 'error', id: 'bad' }, { type: 'pong', id: 'good' }]);
  assert.match(result.stderr, /request failed code=INVALID_REQUEST/);
});

test('real Node subprocess exits nonzero on bad framing or truncated input', async () => {
  const tooLarge = Buffer.alloc(4);
  tooLarge.writeUInt32LE(MAX_FRAME_BYTES + 1);
  for (const input of [tooLarge, Buffer.from([1, 0]), Buffer.from([1, 0, 0, 0, 0x7b])]) {
    const result = await runHost([input]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /transport failure/);
  }
});

test('production CJS host lazily loads installed ESM SDK and DPAPI in isolated storage', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'social-host-storage-'));
  const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CHATGPT_SPIKE_STORAGE_DIR: directory } });
  const decoder = new FrameDecoder();
  const stderr: Buffer[] = [];
  const closed = new Promise<number | null>((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
  const deadline = setTimeout(() => child.kill(), 10_000);
  try {
    child.stderr.on('data', chunk => stderr.push(chunk));
    const response = new Promise<unknown>((resolve, reject) => {
      child.stdout.on('data', chunk => { const messages = decoder.push(chunk); if (messages.length) resolve(messages[0]); });
      child.on('close', () => reject(new Error('Host closed before auth.status.')));
    });
    child.stdin.write(encodeFrame({ version: 2, id: 'status', type: 'auth.status' }));
    assert.deepEqual(await response, { version: 2, id: 'status', type: 'auth.status', connection: { connected: false, planEnabled: false } });
    child.stdin.end(); assert.equal(await closed, 0); decoder.finish();
    assert.equal(Buffer.concat(stderr).toString().includes(directory), false);
  } finally {
    clearTimeout(deadline);
    if (child.exitCode === null) { child.kill(); await closed; }
    assert.equal(path.dirname(directory), tmpdir()); assert.ok(path.basename(directory).startsWith('social-host-storage-'));
    await rm(directory, { recursive: true, force: true });
  }
});
