# FLAME-137 extension → helper → ChatGPT integration

The existing persistent test tab now sends its actual invented transcript through Native Messaging to the shared Windows ChatGPT client and displays only completed, nonempty summary text and the discovered model. Credentials stay in the existing helper store. The diagnostic CLI keeps its original fixture through a thin wrapper around `summariseTranscript`.

Work started from clean `main` at `0a06bd8` on `codex/flame-137-extension-summary`, after reading the FLAME-136 migration report. No dependency, SDK source, licence, application identity, encryption or storage migration is included. This integrates invented text; Discord capture and milestone 1 remain separate work.

## Run from the repository root

```powershell
npm ci
npm run build
npm run typecheck
npm test
npm run test:sdk
npm run test:registration
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-host.ps1
```

Load unpacked `dist/extension` in Chrome's Developer mode. Confirm extension ID `lcfdfljeffdfjefbbokfbldjkgiickfo`. Open `chrome-extension://lcfdfljeffdfjefbbokfbldjkgiickfo/test.html`, or click the toolbar icon to open that persistent tab. Loading/opening it starts no sign-in or inference. **Test helper connection** still runs hello/ping without importing the ChatGPT client. **Check ChatGPT connection** reads only safe connection/plan flags.

Use the existing protected connection. If signed out, explicitly run:

```powershell
npm run chatgpt -- sign-in
```

If signed in without plan permission, explicitly run:

```powershell
npm run chatgpt -- sign-in --consent
```

Complete browser consent, then check/retry from the tab. No reload, rebuild or Chrome restart is needed for an account-state change. Clicking **Summarise test conversation** is the explicit model-use action. Require **Completed summary**, a model and nonempty text. Change both occurrences of Thursday to Sunday and explicitly summarise again; the deadline should change. Do not require identical generated wording. **Cancel** stops a pending request; **Disconnect** or closing/reloading the tab closes its native connection. CLI `disconnect` and `clear-local-credentials` are unrelated destructive account actions and are not test preparation.

## Protocol v2

Every request is strict JSON with `version: 2`, a 1–80 character `[A-Za-z0-9_-]` ID and one supported `type`. Requests/responses reject additional keys. The original 64 KiB cap counts **UTF-8 encoded JSON including escaping and envelope fields**, not string length. Empty/oversized input is rejected before model use. An oversized result becomes a small `OUTPUT_TOO_LARGE` error; there is no truncation or chunking. Frame lengths are validated before allocation; malformed framing closes the host.

| Request | Additional fields | Responses |
| --- | --- | --- |
| `hello` | none | `hello` with host info and v2 capabilities |
| `ping` | none | `pong` with host info and v2 capabilities |
| `auth.status` | none | `auth.status` with only `{connected, planEnabled}`, or `error` |
| `summary.start` | nonempty `transcript` string | correlated `summary.progress` (`checking`, `summarising`), then exactly one `summary.result`, `summary.cancelled` or `error` |
| `summary.cancel` | `targetId`, different from its own ID | `summary.cancel` acknowledgement with `targetId`, or `NOT_RUNNING` error; accepted cancellation also terminates the target with `summary.cancelled` |

Capabilities are `auth.status`, `summary.start` and `summary.cancel`. v1 builds are incompatible: rebuild and reload extension/helper together. Hello/ping behavior and paths remain, with v2 explicitly advertised. Unsupported versions/operations fail clearly. Duplicate in-flight IDs return an uncorrelated `DUPLICATE_ID` (`id: null`), preserving the original ID's single terminal response even when the duplicate is malformed. Another start while work is in flight returns `BUSY` without calling the model. The UI also synchronously guards repeated actions. It discards stale IDs and callbacks from older connections, and renders summary output with `textContent`.

Errors use a finite code set and fixed application messages for signed-out, plan-disabled, model-unavailable, usage-limited, network/refresh, incomplete/empty output, timeout, oversized output and helper failures. Raw provider errors, session/profile objects, account identifiers and credentials never cross the port. Native stdout contains only framed messages; stderr logs process lifecycle and fixed error codes, without transcripts or credentials.

## Asynchronous lifetime and build bridge

`apps/helper/src/native/dispatcher.ts` owns operations. The stdin loop dispatches without awaiting model work, so cancellation and EOF remain readable. The backend receives the actual transcript and the same abort signal through model discovery and SDK streaming. Helper-controlled instructions treat transcript text as source material, not operational commands. Only SDK `response.completed` plus nonempty text can succeed. Partial text is buffered and discarded on incomplete/failed/interrupted/cancelled streams.

The completion rule was checked against [official OpenAI model/inference guidance](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), then verified against the pinned SDK source and interrupted-stream tests.

Hello/ping and cancellation acknowledgements use the short **5s** browser deadline. The helper bounds each auth/model operation at **180s**; the browser allows **185s** to receive its terminal result before disconnecting a wedged host. Cancel/timeout immediately stops progress and marks a single terminal; even a backend that later resolves successfully cannot emit late success. The busy slot/ID stays reserved until the aborted SDK operation settles. If credential rotation is finishing, an immediate explicit retry can return `BUSY`; retry shortly. There are no automatic inference retries.

EOF/disconnection and termination signals abort all operations and await settlement. A **75s** forced-shutdown bound gives the pinned SDK's independent **60s** credential-refresh deadline room to persist rotated credentials/checkpoints and clean up locks. This deliberately does not call SDK `disconnect`, which would revoke/clear the account. Abrupt OS/Chrome termination cannot be made graceful; the unchanged SDK's persisted refresh checkpoint is the recovery mechanism. Real refresh during Chrome termination remains a separate live limit.

The native bundle remains CommonJS at `dist/host/index.cjs`. New `src/native/main.ts` is its production entry; `src/native/index.ts` exports the shared host runtime for a separate test entry. `src/native/backend.ts` uses native `import(modulePath)` to load `../../apps/helper/dist/chatgpt/client.js` relative to the built host, only for auth/summary operations. That ESM module resolves the pinned installed SDK and DPAPI package normally from `apps/helper/dist`. The CLI is not spawned or parsed, and native binaries are not bundled. The root build already creates these ESM outputs before bundling the host; the build log now states the runtime dependency.

The boundary test retains strict native/protocol bundle inputs **and explicitly adds the dynamic ESM dependency assertion**, checking emitted client/DPAPI imports. A real production-host subprocess test loads that CJS → ESM → installed SDK/DPAPI path with isolated empty Windows storage. The independent extension assertion continues to require only extension/protocol inputs and no external imports. Original host name, launcher/registration paths, extension manifest key/ID, registration ownership guards, app ID/name, storage directory, SDK pin/notices and DPAPI encryption format are unchanged. The only toolbar change replaces the short-lived popup with a persistent tab.

## Test evidence — synthetic and transport

Agent-observed checks on **8 October 2026**, Windows x64, Node **24.15.0**, npm **11.12.1**, installed Chrome **154.0.8037.98**:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed: protocol, extension, helper/native and root tests |
| `npm test` | Passed: 18 transport/protocol/dispatcher/boundary tests and 10 helper/CLI/storage/DPAPI tests |
| `npm run test:sdk` | 56 passed, one unchanged Unix-only test skipped; pinned source verification passed |
| `npm run test:registration` | Passed disposable HKCU ownership checks |
| `npm run chatgpt -- help` | Passed; retained diagnostic commands/options |
| `npm run test:integration` | 19 Chrome/native/shared-client/SDK checks passed with the **synthetic provider boundary** |
| `npm run test:chrome` | Passed original native-only hello/ping/disconnect/termination/re-registration/page-close checks with protocol v2; [native transport report](evidence/FLAME-137-chrome-native.json) |
| `npm run test:integration:live` | Passed after explicit user authorisation: two real summaries displayed in Chrome with `gpt-6.1-sol`, following Thursday then Sunday |

The [synthetic Chrome report](evidence/FLAME-137-chrome-synthetic.json) records both actual extension fixtures reaching the model request body, the changed deadline, one request despite repeat clicks, and literal script markup displayed as text. It covers signed-out/plan-disabled versus missing helper, unavailable model, usage/network errors, abrupt EOF, incomplete/empty output, oversized UTF-8 output, cancel/retry, timeout/retry, tab close during inference, verified host termination and recovery, and production hello/ping after re-registration. Default tests also deliberately resolve an aborted backend late and require no success, validate malformed/duplicate IDs and ensure an oversized input never calls the model.

The first Chrome run failed only because its timeout-retry assertion expected Thursday after the second fixture had changed the deadline to Sunday. That assertion was corrected and the full run passed. Mock evidence is never substituted for live acceptance.

`scripts/test-chrome-summary.mjs` runs installed Chrome in a disposable profile with real Native Messaging. Synthetic mode builds a separate exported host runtime (`dist/test-host/runtime.cjs`) and launcher for `tests/synthetic-host.mjs`. This calls the shared Windows client and pinned SDK with real temporary DPAPI-protected synthetic storage, replacing only provider fetch. Unexpected endpoints fail instead of falling through to live network. The normal production registration has no mock switch. The harness ownership-checks registration, restores prior registry views/launcher/manifest and removes only its verified task-created temporary directory. Default `npm test` neither registers a host, opens sign-in, accesses real credentials nor spends real model usage.

## Live acceptance and explicit recipe

**Live acceptance passed after explicit user authorisation.** The test completed on 8 October 2026 at **22:21 AEDT (11:21 UTC)** after the user authorised the two real summaries. The agent ran `npm run test:integration:live` with installed Chrome **154.0.8037.98**, the production CommonJS native host and the user's existing protected ChatGPT connection. Both completed summaries were displayed in the extension with the discovered model **`gpt-6.1-sol`**. The original fixture's result required attendance confirmation by **Thursday**; the changed extension-supplied fixture's result required it by **Sunday**. The actual nonempty completed text and model are preserved in the [live Chrome report](evidence/FLAME-137-chrome-live.json). The screenshot was visually inspected; it displays the changed transcript, completed result and model in Chrome.

The test used an isolated browser profile, disconnected its helper afterward and restored the previous registration/launcher state. It opened no sign-in flow and cleared no saved connection. This is agent-observed extension → native helper → real ChatGPT → displayed summary evidence. Earlier user-confirmed CLI inference/restart reuse in FLAME-135/136 remains background evidence; synthetic failure coverage remains separately labelled.

After authorising two invented model requests using your existing connection:

```powershell
npm run test:integration:live
```

This uses the production registered helper and existing protected connection, checks Thursday then Sunday in displayed Chrome results, records the selected model and saves `evidence/FLAME-137-chrome-live.json` plus an ignored screenshot. It does not open sign-in or clear credentials. If disconnected/plan-disabled, follow the CLI recovery steps above and explicitly rerun. A failed live stream is never promoted to success. There is no automatic live retry.

Live account sign-out/revocation, real usage exhaustion, real network interruption/cancellation, token refresh during shutdown, Windows ARM64 and non-ASCII launcher paths are not established by synthetic coverage. No real connection was cleared to exercise those cases. The future product boundary stays: the user scrolls during explicitly started capture, then explicitly requests summarisation.
