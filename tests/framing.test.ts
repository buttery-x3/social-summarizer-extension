import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameDecoder, encodeFrame } from '../apps/helper/src/native/framing.ts';
import { MAX_FRAME_BYTES } from '@social-summarizer/protocol';

test('UTF-8 length counts bytes, including non-ASCII/newline content', () => {
  const message = { value: 'hello 🐉\n世界' };
  const frame = encodeFrame(message);
  assert.equal(frame.readUInt32LE(), Buffer.byteLength(JSON.stringify(message)));
  const decoder = new FrameDecoder();
  assert.deepEqual(decoder.push(frame), [message]);
  decoder.finish();
});

test('every split point, byte-by-byte input, and consecutive frames decode', () => {
  const messages = [{ version: 1, id: 'first', type: 'hello' }, { version: 1, id: 'second', type: 'ping' }];
  const frames = Buffer.concat(messages.map(encodeFrame));
  for (let split = 0; split <= frames.length; split++) {
    const decoder = new FrameDecoder();
    assert.deepEqual([...decoder.push(frames.subarray(0, split)), ...decoder.push(frames.subarray(split))], messages);
    decoder.finish();
  }
  const decoder = new FrameDecoder();
  assert.deepEqual([...frames].flatMap((byte) => decoder.push(Buffer.from([byte]))), messages);
  decoder.finish();
});

test('zero and oversized lengths fail before allocating a payload', () => {
  for (const length of [0, MAX_FRAME_BYTES + 1, 0xffffffff]) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(length);
    const decoder = new FrameDecoder();
    assert.throws(() => decoder.push(header), /Invalid frame length/);
    assert.throws(() => decoder.push(Buffer.alloc(0)), /closed/);
  }
});

test('malformed UTF-8/JSON and truncated header/body fail', () => {
  for (const body of [Buffer.from('{'), Buffer.from([0xc3, 0x28])]) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length);
    assert.throws(() => new FrameDecoder().push(Buffer.concat([header, body])));
  }
  const frame = encodeFrame({ okay: true });
  for (const length of [1, 2, 3, 4, frame.length - 1]) {
    const decoder = new FrameDecoder();
    decoder.push(frame.subarray(0, length));
    assert.throws(() => decoder.finish(), /incomplete/);
  }
  new FrameDecoder().finish();
});
