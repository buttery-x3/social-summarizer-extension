import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./storage-process.mjs', import.meta.url));
const run = (operation, directory) => execute(process.execPath, [worker, operation, directory], { timeout: 20_000, windowsHide: true });
async function fixture(t, seed = 'seed') {
  const directory = await mkdtemp(join(tmpdir(), 'chatgpt-dpapi-test-'));
  t.after(async () => {
    // Verify this exact test-created directory before recursive cleanup.
    assert.equal(directory.startsWith(join(tmpdir(), 'chatgpt-dpapi-test-')), true);
    await rm(directory, { recursive: true, force: true });
  });
  await run(seed, directory);
  return directory;
}

test('real Windows DPAPI restores SDK credentials in a separate process with private ACLs', async t => {
  const directory = await fixture(t);
  const raw = await readFile(join(directory, 'chatgpt-auth.json'), 'utf8');
  const envelope = JSON.parse(raw);
  assert.equal(envelope.provider, 'windows-dpapi-current-user-aesgcm-v1');
  assert.equal(envelope.version, 3);
  for (const secret of ['fixture-private-access', 'fixture-private-refresh', 'fixture-private-id-token', 'fixture@example.invalid']) {
    assert.equal(raw.includes(secret), false);
  }
  const script = `$ErrorActionPreference='Stop'; $target=$env:CHATGPT_SPIKE_ACL_TARGET; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; foreach($item in @($target, [IO.Path]::Combine($target,'chatgpt-auth.json'))) { $acl=if([IO.Directory]::Exists($item)){[IO.Directory]::GetAccessControl($item)}else{[IO.File]::GetAccessControl($item)}; foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if($rule.IdentityReference.Value -ne $sid -and $rule.IdentityReference.Value -ne 'S-1-5-18') { throw 'Unexpected ACL principal' } } }; 'Private ACL verified'`;
  const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, CHATGPT_SPIKE_ACL_TARGET: directory }, windowsHide: true,
  });
  assert.match(result.stdout, /Private ACL verified/);
  await run('read', directory);
});

for (const operation of ['clear', 'clear-offline']) {
  test(`${operation} removes real DPAPI-protected synthetic tokens across restart`, async t => {
    const directory = await fixture(t);
    await run(operation, directory);
    await run('assert-cleared', directory);
  });
}

test('DPAPI ciphertext corruption is rejected and preserved across restart', async t => {
  const directory = await fixture(t);
  const filename = join(directory, 'chatgpt-auth.json');
  const envelope = JSON.parse(await readFile(filename, 'utf8'));
  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  envelope.ciphertext = bytes.toString('base64');
  const damaged = JSON.stringify(envelope);
  await writeFile(filename, damaged);
  await run('assert-corrupt', directory);
  assert.equal(await readFile(filename, 'utf8'), damaged);
});

test('two Windows processes share one SDK refresh rotation using real DPAPI storage', async t => {
  const directory = await fixture(t, 'seed-expiring');
  await Promise.all([run('refresh', directory), run('refresh', directory)]);
  assert.equal(await readFile(join(directory, 'synthetic-refresh-count'), 'utf8'), '1\n');
});
