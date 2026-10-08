// Real installed Chrome -> service worker -> native host -> shared client/SDK.
// Default mode replaces ONLY the provider fetch boundary, in a separate entry.
// --live is an explicit, user-authorised two-request ChatGPT plan usage test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { idFromKey } from './extension-id.mjs';

if (process.platform !== 'win32') throw new Error('This integration test requires Windows and installed Chrome.');
const live = process.argv.includes('--live');
if (process.argv.slice(2).some(arg => arg !== '--live')) throw new Error('Supported option: --live (consumes ChatGPT plan usage).');
const root = fileURLToPath(new URL('../', import.meta.url));
const hostName = 'com.flamehorn.social_summarizer_spike';
const extensionPath = path.join(root, 'dist/extension');
const hostEntry = path.join(root, 'dist/host/index.cjs');
const manifestPath = path.join(root, '.native-host', `${hostName}.json`);
const launcherPath = path.join(root, '.native-host', 'launch-host.cmd');
const evidencePath = path.join(root, 'docs/feasibility/evidence');
const extensionId = idFromKey(JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8')).key);
const temporary = await mkdtemp(path.join(tmpdir(), 'social-summary-integration-'));
const configPath = path.join(temporary, 'config.json');
const auditPath = path.join(temporary, 'audit.jsonl');
const storage = path.join(temporary, 'synthetic-storage');
const results = [];
const pids = new Set();
let browserContext;
let report;
let ownedRegistration = false;
let chromeVersion;
function ps(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim();
}
const priorRegistration = JSON.parse(ps(`$views = @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64); $values = foreach ($view in $views) { $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view); try { $key = $base.OpenSubKey('Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}'); if ($key) { try { [string]$key.GetValue('') } finally { $key.Dispose() } } else { '' } } finally { $base.Dispose() } }; ConvertTo-Json -InputObject @($values) -Compress`));
async function optionalFile(file) { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
const oldManifest = await optionalFile(manifestPath);
const oldLauncher = await optionalFile(launcherPath);
function registration(script) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', script)],
    { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function waitForExit(pid) {
  const deadline = Date.now() + 10_000;
  while (alive(pid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(alive(pid), false, `Helper ${pid} leaked after close/disconnect.`);
}
function killVerified(pid, synthetic = !live) {
  const command = ps(`$helper = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$helper -or $helper.Name -ne 'node.exe') { throw 'Not a running Node helper' }; $helper.CommandLine`);
  assert.ok(command.includes(synthetic ? path.join(root, 'tests/synthetic-host.mjs') : hostEntry), 'Refusing to kill unrelated PID');
  process.kill(pid);
}
async function scenario(name, timeoutMs = 180_000) { await writeFile(configPath, JSON.stringify({ scenario: name, timeoutMs, storage, audit: auditPath })); }
async function audit() { try { return (await readFile(auditPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
async function state(page, expected, timeout = live ? 190_000 : 20_000) {
  await page.waitForFunction(value => document.querySelector('#status')?.dataset.state === value, expected, { timeout });
  return page.locator('#status').textContent();
}
async function connect(page) {
  await page.locator('#test').click(); await state(page, 'connected');
  const response = JSON.parse(await page.locator('#result').textContent());
  assert.equal(response.type, 'pong'); assert.equal(response.version, 2); pids.add(response.host.pid); return response.host.pid;
}
async function summarise(page, text) {
  if (text) await page.locator('#transcript').fill(text);
  await page.locator('#summary').click();
}
async function completed(page, expectedFact) {
  await state(page, 'completed');
  const text = await page.locator('#summary-result').textContent();
  const model = await page.locator('#model').textContent();
  assert.ok(text.trim()); assert.ok(model && model !== '—');
  assert.match(text, new RegExp(expectedFact, 'i'));
  return { text, model };
}
async function disconnect(page, pid) { await page.locator('#disconnect').click(); await state(page, 'disconnected'); await waitForExit(pid); }

try {
  await mkdir(evidencePath, { recursive: true });
  if (!live) {
    await import('./build-test-host.mjs');
    await scenario('completed');
  }
  // Both views are ownership-checked before replacing any launcher/manifest.
  registration('register-host.ps1'); ownedRegistration = true;
  if (!live) {
    for (const value of [process.execPath, configPath, path.join(root, 'tests/synthetic-host.mjs')]) assert.ok(!/[%"\r\n]/.test(value), 'Unsupported CMD path');
    await writeFile(launcherPath, `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"${process.execPath}" "${path.join(root, 'tests/synthetic-host.mjs')}" "${configPath}" %*\r\n`);
  }
  browserContext = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true,
    args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], viewport: { width: 1000, height: 1100 } });
  const cdp = await browserContext.browser().newBrowserCDPSession();
  assert.equal((await cdp.send('Extensions.loadUnpacked', { path: extensionPath })).id, extensionId);
  chromeVersion = (await cdp.send('Browser.getVersion')).product;
  const page = await browserContext.newPage(); await page.goto(`chrome-extension://${extensionId}/test.html`); await state(page, 'disconnected');
  assert.deepEqual(await audit(), [], 'Page load must not infer');
  let pid = await connect(page);
  const firstFixture = await page.locator('#transcript').inputValue();
  await summarise(page);
  // Dispatch two click events synchronously, bypassing the disabled-button UI
  // to verify the service worker guards duplicate actions too.
  await page.evaluate(() => document.querySelector('#summary').dispatchEvent(new MouseEvent('click')));
  const first = await completed(page, 'Thursday');
  if (!live) {
    assert.equal((await audit()).filter(item => item.event === 'inference').length, 1);
    assert.equal((await audit())[0].text, firstFixture);
    assert.equal(await page.evaluate(() => window.syntheticExecuted), undefined, 'Model output must render as text');
  }
  results.push({ check: 'first fixture and repeat click', passed: true, ...first });
  const secondFixture = firstFixture.replaceAll('Thursday', 'Sunday');
  await summarise(page, secondFixture);
  const second = await completed(page, 'Sunday');
  if (!live) assert.equal((await audit()).filter(item => item.event === 'inference')[1].text, secondFixture);
  results.push({ check: 'changed extension-supplied fact', passed: true, ...second });
  await page.screenshot({ path: path.join(evidencePath, live ? 'FLAME-137-live-completed.png' : 'FLAME-137-synthetic-completed.png'), fullPage: true });
  if (!live) {
    for (const [mode, expected] of [['signed-out', 'signed out'], ['plan-disabled', 'permission is disabled'],
      ['no-models', 'No usable model'], ['usage', 'usage is unavailable'], ['network', 'network'],
      ['interrupted', 'did not complete'], ['incomplete', 'did not complete'], ['empty', 'did not complete'], ['oversized', '64 KiB']]) {
      await scenario(mode); await summarise(page); const detail = await state(page, 'failed');
      assert.match(detail, new RegExp(expected, 'i')); assert.equal(detail.includes('synthetic-private-token'), false);
      assert.equal(await page.locator('#summary-result').textContent(), 'No completed summary yet.');
      assert.equal(await page.locator('#helper-status').textContent(), 'Helper connected');
      results.push({ check: mode, passed: true, detail });
    }
    await scenario('cancel'); await summarise(page); await state(page, 'summarising');
    await page.locator('#cancel').click(); await state(page, 'cancelled');
    assert.equal(await page.locator('#summary-result').textContent(), 'No completed summary yet.');
    results.push({ check: 'explicit cancel', passed: true });
    await scenario('completed'); await summarise(page); await completed(page, 'Sunday');
    results.push({ check: 'explicit retry after cancellation', passed: true });
    // Shorten the model deadline only in the separately built test host.
    await disconnect(page, pid); await scenario('timeout', 500); pid = await connect(page);
    await summarise(page); assert.match(await state(page, 'failed'), /timed out/i);
    results.push({ check: 'model timeout', passed: true });
    await scenario('completed', 500); await summarise(page); await completed(page, 'Sunday');
    results.push({ check: 'explicit retry after timeout', passed: true });
    await disconnect(page, pid); await scenario('close'); pid = await connect(page);
    await summarise(page); await state(page, 'summarising'); await page.close(); await waitForExit(pid);
    results.push({ check: 'tab close during inference', passed: true });
    const recovery = await browserContext.newPage(); await recovery.goto(`chrome-extension://${extensionId}/test.html`);
    await scenario('kill'); pid = await connect(recovery); await summarise(recovery); await state(recovery, 'summarising');
    killVerified(pid); assert.match(await state(recovery, 'error'), /disconnected unexpectedly/i); await waitForExit(pid);
    await scenario('completed'); pid = await connect(recovery); await summarise(recovery); await completed(recovery, 'Thursday');
    results.push({ check: 'host termination and recovery in same tab', passed: true });
    await disconnect(recovery, pid); registration('unregister-host.ps1');
    await recovery.locator('#summary').click(); assert.match(await state(recovery, 'error'), /not registered/i);
    results.push({ check: 'missing helper differs from signed-out/plan-disabled', passed: true });
    // Restore production registration before the recovery check: use hello/ping
    // only, which must load without creating a ChatGPT client or reading tokens.
    registration('register-host.ps1'); pid = await connect(recovery); await disconnect(recovery, pid);
    results.push({ check: 'production host hello/ping after re-registration', passed: true });
  } else {
    await disconnect(page, pid);
  }
  report = { testedAt: new Date().toISOString(), node: process.version, chrome: chromeVersion, extensionId,
    mode: live ? 'LIVE: installed Chrome and production native host; existing protected ChatGPT connection; two real model requests.' :
      'SYNTHETIC MODEL BOUNDARY: installed Chrome and real Native Messaging/dispatcher/Windows DPAPI/shared client/pinned SDK; provider fetch replaced in separate test entry; isolated credentials.',
    allPassed: true, results };
} catch (error) {
  report = { testedAt: new Date().toISOString(), node: process.version, chrome: chromeVersion, extensionId,
    mode: live ? 'LIVE' : 'SYNTHETIC MODEL BOUNDARY', allPassed: false, results, error: error.message };
  process.exitCode = 1;
} finally {
  try {
    await browserContext?.close();
    for (const pid of pids) if (alive(pid)) { killVerified(pid); throw new Error(`Leaked helper ${pid} was forcibly stopped.`); }
  } catch (error) { report = { ...report, allPassed: false, cleanupError: error.message }; process.exitCode = 1; }
  try {
    if (ownedRegistration) {
      // Also replace an interrupted synthetic launcher with production defaults
      // when no previous launcher file existed.
      registration('register-host.ps1');
      registration('unregister-host.ps1');
      if (oldManifest) await writeFile(manifestPath, oldManifest);
      if (oldLauncher) await writeFile(launcherPath, oldLauncher);
    }
    if (ownedRegistration && priorRegistration.some(Boolean)) {
      // Ownership checks above forbid unrelated registrations. Restore precisely
      // the previously present views, not an invented new registration.
      for (let i = 0; i < priorRegistration.length; i++) {
        if (!priorRegistration[i]) continue;
        const view = i === 0 ? 'Registry32' : 'Registry64';
        const value = priorRegistration[i].replaceAll("'", "''");
        ps(`$base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::${view}); try { $key = $base.CreateSubKey('Software\\Google\\Chrome\\NativeMessagingHosts\\${hostName}'); try { $key.SetValue('', '${value}') } finally { $key.Dispose() } } finally { $base.Dispose() }`);
      }
    }
    // Remove only the verified, task-created temporary directory.
    assert.equal(path.dirname(temporary), tmpdir()); assert.ok(path.basename(temporary).startsWith('social-summary-integration-'));
    await rm(temporary, { recursive: true, force: true });
  } catch (error) { report = { ...report, allPassed: false, restorationError: error.message }; process.exitCode = 1; }
  await writeFile(path.join(evidencePath, live ? 'FLAME-137-chrome-live.json' : 'FLAME-137-chrome-synthetic.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
