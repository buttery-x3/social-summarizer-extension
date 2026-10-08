import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('built extension and native transport contain only their intended modules', async () => {
  for (const [file, source] of [['extension', 'apps/extension/src/'], ['host', 'apps/helper/src/native/']] as const) {
    const metadata = JSON.parse(await readFile(new URL(`../dist/${file}-metafile.json`, import.meta.url), 'utf8'));
    const inputs = Object.keys(metadata.inputs);
    assert.ok(inputs.some(input => input.startsWith(source)));
    assert.ok(inputs.includes('packages/protocol/dist/index.js'), 'both builds use the shared workspace contract');
    for (const input of inputs) {
      assert.ok(input.startsWith(source) || input.startsWith('packages/protocol/dist/'), `Unexpected bundled module: ${input}`);
    }
    if (file === 'extension') {
      for (const output of Object.values(metadata.outputs) as { imports: unknown[] }[]) {
        assert.deepEqual(output.imports, [], 'browser build must be self-contained');
      }
    }
  }
  const manifest = JSON.parse(await readFile(new URL('../dist/extension/manifest.json', import.meta.url), 'utf8'));
  const id = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)]
    .flatMap(byte => [byte >> 4, byte & 15]).map(nibble => String.fromCharCode(97 + nibble)).join('');
  assert.equal(id, 'lcfdfljeffdfjefbbokfbldjkgiickfo');
});
