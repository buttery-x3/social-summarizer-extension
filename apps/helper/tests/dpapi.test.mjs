import assert from 'node:assert/strict';
import test from 'node:test';
import { createDpapiEncryption } from '../dist/chatgpt/dpapi.js';

test('authenticated DPAPI envelope rejects changes in every region and truncated data', async () => {
  const provider = createDpapiEncryption();
  assert.equal(await provider.isAvailable(), true);
  const original = Buffer.from(await provider.encrypt('Synthetic envelope test'));
  assert.equal(await provider.decrypt(original), 'Synthetic envelope test');
  const keyLength = original.readUInt32BE(4);
  for (const offset of [0, 4, 8, 8 + Math.floor(keyLength / 2), 8 + keyLength - 1,
    8 + keyLength, 8 + keyLength + 12, original.length - 1]) {
    const corrupted = Buffer.from(original);
    corrupted[offset] ^= 0xff;
    assert.throws(() => provider.decrypt(corrupted));
  }
  for (const length of [0, 7, 36, original.length - 1]) assert.throws(() => provider.decrypt(original.subarray(0, length)));
});
