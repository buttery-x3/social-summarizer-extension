# Social Summarizer feasibility workspace

One small project with two runtime components: a Chrome extension and its Windows local helper. The extension's persistent test tab sends an invented conversation through Native Messaging to the helper's existing ChatGPT connection and displays a completed summary and model. Sign-in stays in the diagnostic CLI; credentials stay in the helper. Discord capture is later work.

## Install and check

Use Windows x64, Node **24.15.0**, npm **11.12.1**, and installed Google Chrome 120+ for the live browser test. Run every command below from the repository root, including when using an extracted source archive:

```powershell
node --version
npm --version
npm ci
npm run build
npm run typecheck
npm test
npm run test:sdk
npm run test:registration
```

There is one installation and one active lockfile. Root `.npmrc` enforces Node requirements and disables dependency lifecycle scripts, preserving the ChatGPT experiment's `--ignore-scripts` installation policy. The locked packages supply prebuilt esbuild, TypeScript and DPAPI binaries; no second install, Python, Visual Studio, Electron or browser download is needed on the tested Windows x64 runtime. Explicit `npm run` scripts still run.

Build order is protocol → SDK integrity check/build/notice copying → helper ESM compilation and CommonJS native transport → extension. The root checks cover both components and the shared contract. Default checks use synthetic credentials and temporary test storage; they do not open account sign-in, make live model requests or change the real native-host registration. `test:registration` uses disposable registry keys.

| Workspace | Responsibility | Build output |
| --- | --- | --- |
| `apps/extension` | Existing MV3 page, service worker and connection lifecycle; browser/Chrome types only | `dist/extension` |
| `apps/helper` | Native framing, async summary/cancellation, reusable ChatGPT client, DPAPI and storage; `src/cli.ts` is a diagnostic entry point | `dist/host/index.cjs`; `apps/helper/dist/cli.js` and `apps/helper/dist/chatgpt/` |
| `packages/protocol` | Browser-safe message types, constants and request/response validation | `packages/protocol/dist` |

The CommonJS native bundle contains native/protocol code and lazily imports the shared helper ESM client for status/summary operations. Installed SDK/DPAPI dependencies resolve from `apps/helper/dist`; native binaries are not bundled. Hello/ping needs no ChatGPT connection. The extension bundles only extension/protocol code. The DevKit is the helper's pinned local dependency, outside the first-party workspace list. TypeScript **5.9.3** remains in the browser/protocol/root checks and **7.0.2** in the helper/SDK, with their original Node type versions.

Targeted commands from the root:

```powershell
npm run build:extension
npm run build:helper
npm run test:helper
npm run test:transport  # After npm run build
npm run verify:vendor
npm run extension:id
npm run chatgpt -- help
```

Individual typechecks can run after the root build with `npm run typecheck -w apps/extension`, `npm run typecheck -w apps/helper`, or `npm run typecheck -w packages/protocol`. The upstream SDK suite remains explicit as `npm run test:sdk`.

## Chrome ↔ helper demonstration

Build, then register under the current Windows user's HKCU keys (both registry views; no administrator access):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-host.ps1
```

Registration resolves an absolute Node 24 executable. Use `-NodePath 'C:\path\to\node.exe'` to select a different compatible binary. It creates `.native-host/launch-host.cmd` and the manifest for `com.flamehorn.social_summarizer_spike`. Registration/unregistration refuse another checkout's manifest or unrelated values/subkeys.

1. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the root **`dist/extension`** directory.
2. Confirm ID **`lcfdfljeffdfjefbbokfbldjkgiickfo`**. The original public manifest key is unchanged.
3. Open `chrome-extension://lcfdfljeffdfjefbbokfbldjkgiickfo/test.html`, or click the toolbar icon to open that persistent tab. Click **Test helper connection** to exchange hello/ping; click again to reuse the process.
4. Click **Check ChatGPT connection**. If signed out, run `npm run chatgpt -- sign-in` from this root and complete browser consent. If plan permission is disabled, use `npm run chatgpt -- sign-in --consent`. Then check again in the tab.
5. Click **Summarise test conversation**. This explicit action uses your ChatGPT plan. Require **Completed summary**, nonempty text and a model. Change both occurrences of Thursday to Sunday and explicitly summarise again; the result should follow the changed deadline.
6. **Cancel** stops a current request. **Disconnect**, reload or closing the tab closes its helper. Retries are explicit. Hello/ping has a 5s deadline; each connection/model operation has a 180s deadline. No percentages or partial output count as completion.

The reproducible integration checks use an isolated Chrome profile:

```powershell
npm run test:integration       # Real Chrome/native/SDK/DPAPI; synthetic provider, isolated credentials
npm run test:integration:live  # Explicit live test: two invented summaries using your saved ChatGPT connection
```

Run the live command only when you authorise that plan usage. Neither command opens sign-in or clears real credentials. Integration checks ownership-check and temporarily change this checkout's registration/launcher, then restore their previous state. Close other test tabs first. Failure cases use a separate synthetic host entry; production registration has no mock switch. See [FLAME-137 decisions and evidence](docs/feasibility/FLAME-137-integration.md) for exact coverage and remaining live checks.

The real automated Windows test uses installed Chrome and a disposable profile:

```powershell
npm run test:chrome
```

Close manually connected test pages first. This explicit command temporarily registers/unregisters this checkout, checks process cleanup, and **leaves it unregistered**. It writes `docs/feasibility/evidence/chrome-live.json` and screenshots. It does not use your normal Chrome profile.

Disconnect/close the page before uninstalling the registration:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\unregister-host.ps1
```

Generated output and registration paths stay unchanged, so this source reorganisation needs no old-registration migration within the same checkout. If relocating the entire checkout, unregister using the **old checkout's** script first, then build/register the new checkout. Never bypass the ownership guard. Remove the unpacked extension in Chrome when finished.

## ChatGPT diagnostic demonstration

Use your existing Windows account and protected connection; moving source folders does not move or clear credentials. Start with:

```powershell
npm run chatgpt -- status
npm run chatgpt -- models
npm run chatgpt -- summary
```

If signed out, run `npm run chatgpt -- sign-in`, complete **Continue with ChatGPT** and explicitly allow plan use, then repeat models/summary. Success requires **`Completed summary (...)`** with nonempty text. Each invocation is a new process; repeating status/summary verifies restart reuse. The summary uses ChatGPT plan usage.

All previous commands/options remain available, including `profiles`, `select PROFILE_ID`, `sign-in --new`, `sign-in --consent`, `summary --model SLUG`, `--timeout-ms N`, `disconnect` and `clear-local-credentials`. The two disconnect commands intentionally revoke the selected session and clear its local tokens; they are not migration steps. Ctrl+C cancels sign-in/requests.

`CHATGPT_SPIKE_STORAGE_DIR` still defaults to `%LOCALAPPDATA%\SocialSummarizerChatGPTSpike`; `CHATGPT_SPIKE_PORT` still defaults to `0`. App/client/profile/installation identities, CurrentUser DPAPI entropy/provider ID and authenticated envelope format are preserved. Auth/storage code exists once in `apps/helper/src/chatgpt`, shared by the CLI and native host. Detailed configuration, protection, commands and historical evidence are in [FLAME-135](docs/feasibility/FLAME-135-chatgpt.md).

## Evidence, licensing and next work

[FLAME-136 migration results](docs/feasibility/FLAME-136-workspaces.md) contain the old-to-new path map, exact checks, dependency review, user-confirmed live account verification and remaining limits. [FLAME-134 results](docs/feasibility/FLAME-134-results.md) preserve the original transport findings. The earlier FLAME-135 source attachment is preserved as a [historical archive](docs/feasibility/evidence/README.md), outside the active installation.

The owner has not chosen an application licence: first-party packages retain `UNLICENSED`, and this cleanup grants no redistribution rights. Existing third-party rights and notices remain intact. The unmodified DevKit has its own **noncommercial licence**, not MIT/Apache; see [helper third-party notices](apps/helper/THIRD_PARTY_NOTICES.md) and the [upstream licence](apps/helper/vendor/devkit/LICENSE).

[FLAME-137](docs/feasibility/FLAME-137-integration.md) integrates explicit summary/cancellation using protocol v2 and the existing 64 KiB UTF-8 JSON cap. Rebuild and reload extension/helper together after this protocol change. Paths, extension ID, host name, protected storage and pinned SDK/notices are preserved. Discord capture and production installers remain future work. The intended Discord workflow remains user-started capture while the user manually scrolls, followed by an explicit summary request. This invented-text integration alone does not complete that workflow or milestone 1.
