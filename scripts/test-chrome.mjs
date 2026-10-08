// Live Windows Chrome -> MV3 service worker -> registered Node process, no mocks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { idFromKey } from './extension-id.mjs';

if (process.platform !== 'win32') throw new Error('The live feasibility test requires Windows.');
const root = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = path.join(root, 'dist/extension');
const hostEntry = path.join(root, 'dist/host/index.cjs');
const evidencePath = path.join(root, 'docs/feasibility/evidence');
const manifest = JSON.parse(await readFile(path.join(extensionPath, 'manifest.json'), 'utf8'));
const extensionId = idFromKey(manifest.key);
const results = [];
const hostPids = new Set();
let browserContext;
let report;
function psQuote(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function ps(command) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim();
}
function registration(script) {
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', script)],
    { encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function waitForExit(pid) {
  const deadline = Date.now() + 5000;
  while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(alive(pid), false, `Helper ${pid} is still running after disconnect.`);
}
function killVerifiedHelper(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const command = ps(`$helper = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -eq $helper) { throw 'Helper already exited' }; if ($helper.Name -ne 'node.exe') { throw 'PID is not Node' }; $helper.CommandLine`);
  assert.ok(command.includes(hostEntry), `Refusing to kill PID ${pid}: not this spike's helper.`);
  process.kill(pid);
}
async function status(page, state) {
  await page.waitForFunction((expected) => document.querySelector('#status')?.dataset.state === expected, state, { timeout: 10000 });
  return page.locator('#status').innerText();
}
async function connect(page, label) {
  await page.getByRole('button', { name: 'Test helper connection', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#status')?.dataset.state === 'connected' &&
    document.querySelector('#status')?.textContent?.startsWith('Ping passed.'), undefined, { timeout: 10000 });
  const response = JSON.parse(await page.locator('#result').textContent());
  assert.equal(response.version, 2);
  assert.equal(response.type, 'pong');
  assert.match(response.id, /^[a-f0-9-]{36}$/);
  assert.equal(response.host.nodeVersion, process.version);
  assert.equal(response.host.platform, 'win32');
  assert.ok(alive(response.host.pid));
  assert.ok((await page.locator('#status').innerText()).includes(response.id));
  hostPids.add(response.host.pid);
  results.push({ label, response, detail: await page.locator('#status').innerText() });
  return response;
}

await mkdir(evidencePath, { recursive: true });
try {
  // Registration refuses any pre-existing key owned by another checkout.
  registration('register-host.ps1');
  browserContext = await chromium.launchPersistentContext('', {
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-extension-debugging'],
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1000, height: 850 }
  });
  const browser = browserContext.browser();
  const cdp = await browser.newBrowserCDPSession();
  const loaded = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
  assert.equal(loaded.id, extensionId);
  const browserVersion = await cdp.send('Browser.getVersion');
  const page = await browserContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/test.html`);
  await status(page, 'disconnected');
  const first = await connect(page, 'initial hello + ping');
  await page.screenshot({ path: path.join(evidencePath, 'chrome-connected.png'), fullPage: true });
  const secondPing = await connect(page, 'second ping on same native port');
  assert.equal(secondPing.host.pid, first.host.pid);
  assert.notEqual(secondPing.id, first.id);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await status(page, 'disconnected');
  await waitForExit(first.host.pid);
  results.push({ label: 'explicit disconnect', pid: first.host.pid, exited: true });

  const reconnected = await connect(page, 'fresh connection after explicit disconnect');
  assert.notEqual(reconnected.host.pid, first.host.pid);
  killVerifiedHelper(reconnected.host.pid);
  const terminatedDetail = await status(page, 'error');
  assert.match(terminatedDetail, /disconnected unexpectedly/i);
  results.push({ label: 'terminated helper', pid: reconnected.host.pid, detail: terminatedDetail });
  await page.screenshot({ path: path.join(evidencePath, 'chrome-terminated.png'), fullPage: true });
  await waitForExit(reconnected.host.pid);
  const recovered = await connect(page, 'fresh connection after terminated helper');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await status(page, 'disconnected');
  await waitForExit(recovered.host.pid);

  registration('unregister-host.ps1');
  await page.getByRole('button', { name: 'Test helper connection', exact: true }).click();
  const missingDetail = await status(page, 'error');
  assert.match(missingDetail, /not registered/i);
  results.push({ label: 'unregistered helper', detail: missingDetail });
  await page.screenshot({ path: path.join(evidencePath, 'chrome-missing.png'), fullPage: true });
  registration('register-host.ps1');
  const restored = await connect(page, 'fresh connection after re-register');
  await page.close();
  await waitForExit(restored.host.pid);
  results.push({ label: 'test page closed', pid: restored.host.pid, exited: true });

  const windows = ps("$info = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'; $os = Get-CimInstance Win32_OperatingSystem; @{ Caption=$os.Caption; Version=$os.Version; Architecture=$os.OSArchitecture; DisplayVersion=$info.DisplayVersion; Build=$info.CurrentBuild; UBR=$info.UBR } | ConvertTo-Json -Compress");
  report = { testedAt: new Date().toISOString(), windows: JSON.parse(windows), node: process.version,
    chrome: browserVersion.product, extensionId, mode: 'Installed Google Chrome, headless, isolated temporary persistent profile; real native host, no mocked Chrome APIs.', results, allPassed: true };
} catch (error) {
  report = { testedAt: new Date().toISOString(), node: process.version, extensionId, results,
    allPassed: false, error: error instanceof Error ? error.message : String(error) };
  throw error;
} finally {
  try {
    if (browserContext) await browserContext.close();
    registration('unregister-host.ps1');
    for (const pid of hostPids) {
      if (alive(pid)) { killVerifiedHelper(pid); throw new Error(`Leaked helper ${pid} was forcibly stopped. Test failed.`); }
    }
  } catch (error) {
    report = { ...report, allPassed: false, cleanupError: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    await writeFile(path.join(evidencePath, 'chrome-live.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  }
}
