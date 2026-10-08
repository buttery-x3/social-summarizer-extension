# Chrome ↔ Windows helper feasibility (FLAME-134)

A runnable Manifest V3/TypeScript extension and Node 24/TypeScript native host. The extension page owns a service-worker connection; Chrome starts the helper only when **Test helper connection** is clicked. Hello and ping use protocol version 1 and matching request IDs. Disconnecting or closing the page closes the helper's input.

## Build and register

Use Windows, Google Chrome 120+ and Node **24.x** with npm. These commands run from this directory in PowerShell; registration needs no administrator access.

```powershell
node --version
npm ci
npm run typecheck
npm test
npm run test:registration
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-host.ps1
```

`npm test` builds `dist/extension` and `dist/host/index.cjs` before running ten local transport/protocol tests. Registration resolves the current `node.exe` to an absolute path, requires Node 24, generates `.native-host/launch-host.cmd` and a native-host JSON manifest, and registers it under this user's HKCU Chrome `NativeMessagingHosts` key in both registry views. An optional `-NodePath 'C:\path\to\node.exe'` chooses another Node 24 binary.

## Load unpacked and test

1. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this project's **`dist/extension`** folder (not `src/extension`).
2. Confirm the displayed extension ID is **`lcfdfljeffdfjefbbokfbldjkgiickfo`**. `npm run extension:id` also prints it.
3. Open `chrome-extension://lcfdfljeffdfjefbbokfbldjkgiickfo/test.html` in a Chrome tab, or open the extension's toolbar popup. A tab is convenient for the lifecycle checks below.
4. Click **Test helper connection**. The result must contain `version: 1`, `type: "pong"`, a request ID matching the status, and the helper's real PID/Node version. Hello is checked before ping. Click Test again to send another ping on the same process.
5. Click **Disconnect**. Verify the displayed PID has exited with `Get-Process -Id <PID> -ErrorAction SilentlyContinue` (no result means exited). Test again; Chrome should start a new PID. Closing the tab/popup also stops its helper.
6. While connected, stop **only the PID shown by this test page** with `Stop-Process -Id <PID>`. The page must show **Helper disconnected unexpectedly**. Click Test to recover.
7. Disconnect, run the unregister command below, then click Test. The page must show **Helper is not registered**. Register again and retry; no page reload should be necessary.

The checked-in manifest `key` is a public development key that keeps the extension ID stable across folders and machines; no private signing key is needed or stored. The registration script derives the ID from it, and `allowed_origins` contains exactly that one extension. If you intentionally replace the key, rebuild, re-register, reload the extension, and use the newly displayed ID. The key is for this spike, not a production Web Store release identity.

## Unregister

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\unregister-host.ps1
```

Disconnect or close the test page first. This removes only `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.flamehorn.social_summarizer_spike` in both registry views. It refuses keys pointing to another checkout or containing unrelated values/subkeys; it never deletes another host or the parent registry key. Generated files remain in `.native-host`. Remove the unpacked extension through `chrome://extensions` when finished.

## Repeat the real Chrome test

```powershell
npm run test:chrome
```

This uses the installed Google Chrome and Playwright in a temporary, isolated profile. It runs headless, loads the actual unpacked extension through Chrome's DevTools `Extensions.loadUnpacked` command, clicks the page buttons, and uses the real Windows registry and native process. No Chrome API or helper responses are mocked. No additional browser download is needed. The debugging flag applies only to this disposable test process. The command temporarily registers/unregisters this checkout's host, leaves it unregistered, checks helper PIDs exit, and writes `evidence/chrome-live.json` plus three screenshots. It does not use your ordinary Chrome profile. Close any manually connected test pages before running it.

## Transport and scope

Frames are a four-byte little-endian UTF-8 byte count followed by JSON. This spike deliberately limits frames to **64 KiB** in either direction, below Chrome's transport limits. Fragmented headers/payloads and consecutive frames are supported. Invalid lengths, malformed UTF-8/JSON and truncated input terminate the connection with diagnostics on **stderr**; stdout contains only framed responses. Invalid request shapes or unsupported protocol versions receive versioned error responses; only `hello` and `ping` are accepted. A five-second extension timeout closes an unresponsive connection and enables retry.

The Windows CMD launcher is needed to invoke an existing Node runtime; requests never execute commands. Paths containing percent signs, quotes or newlines are rejected. The tested checkout and runtime paths use ASCII characters; non-ASCII CMD paths remain unverified. Each page owns one port, and its close/disconnect releases the native process. There is no automatic reconnect or permanent background connection.

See [observed results and exact versions](evidence/RESULTS.md). This validates local transport only. ChatGPT authentication/model calls, Discord capture, production packaging and installer work are outside this spike.

References: [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key), [service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [Chrome DevTools protocol source](https://github.com/ChromeDevTools/devtools-protocol/blob/master/json/browser_protocol.json).
