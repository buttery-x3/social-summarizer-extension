import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
// Test-only exported runtime. The normal host entry always uses windowsBackend.
await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)), entryPoints: ['apps/helper/src/native/index.ts'],
  outfile: 'dist/test-host/runtime.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs' });
