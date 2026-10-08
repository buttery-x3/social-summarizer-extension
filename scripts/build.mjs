import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = process.argv[2];
if (!target) {
  // Do not depend on workspace discovery order or pre-existing generated files.
  for (const workspace of ['packages/protocol', 'apps/helper', 'apps/extension']) {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '-w', workspace],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
} else if (target === 'helper') {
  const result = await build({ absWorkingDir: root, entryPoints: ['apps/helper/src/native/main.ts'],
    outfile: 'dist/host/index.cjs', bundle: true, platform: 'node', target: 'node24',
    format: 'cjs', sourcemap: true, metafile: true });
  await writeFile(path.join(root, 'dist/host-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  console.log('Built dist/host/index.cjs; native requests lazily import the shared ESM client in apps/helper/dist.');
} else if (target === 'extension') {
  await mkdir(path.join(root, 'dist/extension'), { recursive: true });
  const result = await build({ absWorkingDir: root,
    entryPoints: ['apps/extension/src/service-worker.ts', 'apps/extension/src/test-page.ts'],
    outdir: 'dist/extension', bundle: true, platform: 'browser', target: 'chrome120',
    format: 'esm', sourcemap: true, metafile: true });
  for (const file of ['manifest.json', 'test.html', 'test.css']) {
    await copyFile(path.join(root, 'apps/extension/src', file), path.join(root, 'dist/extension', file));
  }
  await writeFile(path.join(root, 'dist/extension-metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  console.log('Built dist/extension.');
} else {
  throw new Error(`Unknown build target: ${target}`);
}
