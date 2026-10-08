import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(path.join(root, 'dist/extension'), { recursive: true });
await build({ entryPoints: [path.join(root, 'src/host/index.ts')], outfile: path.join(root, 'dist/host/index.cjs'),
  bundle: true, platform: 'node', target: 'node24', format: 'cjs', sourcemap: true });
await build({ entryPoints: [path.join(root, 'src/extension/service-worker.ts'), path.join(root, 'src/extension/test-page.ts')],
  outdir: path.join(root, 'dist/extension'), bundle: true, platform: 'browser', target: 'chrome120', format: 'esm', sourcemap: true });
for (const file of ['manifest.json', 'test.html', 'test.css'])
  await copyFile(path.join(root, 'src/extension', file), path.join(root, 'dist/extension', file));
console.log('Built dist/extension and dist/host/index.cjs.');
