import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../vendor/devkit/', import.meta.url);
const upstream = JSON.parse(await readFile(new URL('UPSTREAM.json', root), 'utf8'));
for (const [file, expected] of Object.entries(upstream.sha256)) {
  const bytes = await readFile(new URL(file, root));
  if (createHash('sha256').update(bytes).digest('hex') !== expected) {
    throw new Error(`Vendored source differs from pinned revision: ${file}`);
  }
}
console.log(`Verified unmodified DevKit sources at ${upstream.revision}.`);
