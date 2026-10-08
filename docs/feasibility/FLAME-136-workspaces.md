# FLAME-136 workspace consolidation

This is a behaviour-preserving reorganisation of the two completed feasibility experiments. It adds no auth/summary transport operation or Discord feature. The checkout started clean on `main` at `70ef1d6351bd76c48527cf9b986219bdc14bede2`; unrelated working changes were absent. Work is on `codex/flame-136-workspaces`, with mechanical moves separated from build/configuration changes.

## Old-to-new paths

| Original path | Current path |
| --- | --- |
| `src/extension/*` | `apps/extension/src/*` |
| `src/host/{index,framing}.ts` | `apps/helper/src/native/{index,framing}.ts` |
| `src/shared/protocol.ts` | `packages/protocol/src/index.ts`; host execution moved to `apps/helper/src/native/handle-request.ts` |
| `chatgpt-cli/src/cli.ts` | `apps/helper/src/cli.ts` |
| `chatgpt-cli/src/{client,dpapi,storage}.ts` | `apps/helper/src/chatgpt/{client,dpapi,storage}.ts` |
| `chatgpt-cli/{tests,scripts,vendor,licenses}` | `apps/helper/{tests,scripts,vendor,licenses}` |
| `chatgpt-cli/THIRD_PARTY_NOTICES.md` | `apps/helper/THIRD_PARTY_NOTICES.md` |
| `chatgpt-cli/{.node-version,.npmrc}` | Root `.node-version` and `.npmrc` |
| Root and CLI `package-lock.json` | One root `package-lock.json` for explicit first-party workspaces and local SDK dependency |
| Root `tsconfig.json` | Root `tsconfig.base.json` plus browser/protocol/helper/native/test configs |
| Root README / `evidence/RESULTS.md` | `docs/feasibility/FLAME-134-native-messaging.md` / `FLAME-134-results.md` |
| `chatgpt-cli/README.md` | `docs/feasibility/FLAME-135-chatgpt.md` |
| Duplicate `evidence/FLAME-135-package-check` source tree | `docs/feasibility/evidence/FLAME-135-package-check.zip` (historical, all 60 tracked files preserved byte-for-byte) |
| New Chrome test reports/screenshots | `docs/feasibility/evidence/` |
| `chatgpt-cli/dist/cli.js` and reusable module output | `apps/helper/dist/cli.js` and `apps/helper/dist/chatgpt/` |

Root `tests/` remains the cross-component transport/protocol/process suite. `scripts/` remains the build coordinator and Windows registration location. `dist/extension`, `dist/host/index.cjs`, `.native-host/launch-host.cmd`, `.native-host/com.flamehorn.social_summarizer_spike.json` and both HKCU registration locations remain unchanged.

The original ignored evidence/attachment files already present in this checkout are historical artifacts; they are not installation inputs. The former ignored CLI build/dependencies and extracted attachment tree are preserved under `.research/flame-136-old-cli-build` and `.research/flame-136-original-extracted-attachment` rather than deleted. The checked-in ZIP preserves the prior README's original evidence and licence text, including statements superseded by later user confirmation.

## Dependency/build review

`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` regenerated the coordinated lock; `npm ci --no-audit --no-fund` installed it. Each registry package's version was compared against the two original locks: **no new registry dependency version or unrelated upgrade** was introduced. Existing root dependency ranges were pinned to their locked versions to prevent migration drift.

The root/browser/protocol use TypeScript 5.9.3; the helper and SDK retain 7.0.2. Root cross-component tests retain Node types 24.19.1/undici-types 7.24.6; helper/SDK retain Node types 24.13.5/undici-types 7.18.2. npm hoists compatible dependencies and keeps differing compiler/types versions under `apps/helper/node_modules`; these are outputs of the single root install, not separate installation roots.

The SDK remains `@siwc/local` 0.1.0 at `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`, linked from `apps/helper/vendor/devkit/packages/local`. The three explicit first-party workspaces are `packages/protocol`, `apps/extension` and `apps/helper`. All 47 baseline vendor/licence/client/DPAPI/storage/manifest files compared equal to their original Git blobs; upstream code, provenance, licences and original inventory are unmodified. SDK builds verify hashes before compilation and notice copying.

Root `.npmrc` retains `engine-strict=true` and adds `ignore-scripts=true`, making the CLI's original installation restriction common to the workspace. Prebuilt esbuild, helper TypeScript and DPAPI native dependencies load on the tested Windows x64 Node 24.15.0/npm 11.12.1 runtime. Actual DPAPI encryption/decryption and ACLs are exercised in temporary synthetic test storage.

Separate compiler environments provide Chrome/DOM types only to the browser, no ambient runtime globals to the protocol, and Node types to native/helper/tests. The protocol validates request shape/version and responses; the helper performs hello/ping execution. A new build-metadata regression test ensures the extension contains only extension/protocol inputs and no external imports, and that the CommonJS native target contains only native/protocol inputs. CLI/SDK ESM and native dependency loading remain separate from the CommonJS transport.

## Commands executed and observed results

All results below are from 8 October 2026 on Windows 11 x64, Node 24.15.0 and npm 11.12.1. Baseline commands ran before edits:

| Command/context | Result |
| --- | --- |
| Original root `npm run typecheck` and `npm test` | Passed; 10/10 transport/protocol/process tests |
| Original CLI `npm run typecheck` and `npm test` | Passed; SDK hashes/build/notice copy and 10/10 helper tests |
| Original CLI `npm run test:sdk` | 56 passed, one Unix-only permission/symlink test skipped |
| Original root `npm run test:registration` | Passed using disposable HKCU keys |
| Migrated root `npm ci --no-audit --no-fund` | Passed, dependency install scripts disabled |
| Migrated root `npm run typecheck` | Passed across protocol, extension, helper, native and root tests; includes SDK integrity/build |
| Migrated root `npm test` | Build passed in deliberate order; 11/11 transport/build-boundary tests and 10/10 helper tests passed |
| Migrated root `npm run test:sdk` | SDK verification/build/notice copy passed; 56 passed, same Unix-only skip |
| Migrated root `npm run test:registration` | Ownership guard passed after relocation |
| Migrated root `npm run test:chrome` | Real installed Chrome 154.0.8037.98 passed; see below |
| Migrated root `npm run chatgpt -- help` | Passed; all retained commands/options reachable through root wrapper |
| Migrated root `npm run extension:id` | Original ID `lcfdfljeffdfjefbbokfbldjkgiickfo` |
| `npm ls --workspaces --depth=0` | Exactly three first-party workspace links; local SDK linked as helper dependency; original compiler versions resolved |
| Historical ZIP/content and unchanged-source verification | All 60 archive file blobs and 47 unchanged moved-file blobs match baseline |

The real Chrome test recorded completion at **20:55 AEDT (09:55 UTC)**. It passed hello/ping on the same native port, explicit disconnect/PID exit, reconnect with a new PID, intentional verified-host termination and recovery, unregistered-host errors, re-registration without page reload, and page-close/PID exit. The test left both registry views unregistered and all recorded helper PIDs exited. The exact [native-only report](evidence/FLAME-136-chrome-live.json) is retained; temporary-profile Chrome APIs and Native Messaging were not mocked. Human Load unpacked/toolbar-popup operation and non-ASCII launcher paths remain outside this automated rerun, as in the original proof.

An independent Git source export into a fresh temporary directory contained no `node_modules`, first-party/SDK `dist`, old `chatgpt-cli` directory or ignored artifacts. With only a root installation, these commands all passed: `npm ci --no-audit --no-fund`, `npm run typecheck` (before building the apps), `npm run build`, `npm test`, `npm run test:sdk`, `npm run test:registration`, `npm run chatgpt -- help`, `npm run extension:id` and `npm ls --workspaces --depth=0`. Results matched the primary checkout: 21 first-party passes, 56 SDK passes/one unchanged skip, native DPAPI loading/ACL checks, original extension ID, and both compiler versions. No inherited old dependency/build artifacts were needed.

## User-confirmed live migration results and remaining limits

FLAME-135's original automated report left live sign-in/inference outstanding. The user later confirmed "tested manually and reviewed confirmed live acceptance ✅" on the completed issue at 20:31 AEDT on 8 October 2026. The detailed write-up records that correction without inventing raw output or reopening FLAME-134/135.

During this migration, the user reran the root CLI and reported that summary gives an error because they are currently signed out, while the CLI appears functional. That verifies the migrated diagnostic entry point's signed-out refusal, **not** live post-migration inference or restored account state. The agent did not read, clear or migrate the user's real credentials, nor start account sign-in or model requests.

The user subsequently ran the current root command sequence and reported on 8 October 2026 that both summary commands work and repeat the output. Each CLI invocation starts a separate process, so the second successful summary confirms protected connection reuse after process restart. This is **user-confirmed live post-migration inference and restart reuse**, not an agent-observed provider trace. No raw authentication diagnostics or credentials were collected. The initial signed-out result above remains part of the evidence history.

The reproducible live verification, from the repository root under the same Windows account:

```powershell
npm run chatgpt -- sign-in
npm run chatgpt -- status
npm run chatgpt -- models
npm run chatgpt -- summary
npm run chatgpt -- status
npm run chatgpt -- summary
```

Complete browser sign-in/plan permission, then require nonempty `Completed summary (...)` output. The final two commands are new processes and verify the protected connection's reuse. Both summaries use the same built-in invented transcript, so repeated content is expected; the second call checks persistence, not a different summarisation task. `sign-in --consent` remains available when deliberately reconnecting plan permission. Keep existing credentials; do not use `--new` or clear commands as migration steps. Real token refresh/revocation/usage limits, account/region restrictions, live cancellation and Windows ARM64 remain unverified in this rerun; synthetic test coverage is not live evidence.

All compatibility-sensitive values are unchanged: manifest key/ID, native-host name, ChatGPT app name/ID, `CHATGPT_SPIKE_*` configuration, default storage directory, encryption-provider ID, DPAPI entropy/envelope and SDK profile/installation identifiers. Within the same checkout, registration path compatibility is preserved. If moving the checkout itself, first unregister using its old location; then build/register at the new location. Both scripts retain strict ownership checks.

Application licensing remains an owner decision (`UNLICENSED`, no new grant). Vendor licences/notices are intact. Later work must resolve the five-second timeout/page-owned lifecycle, hello/ping-only protocol/64 KiB cap, ESM/CommonJS and native packaging, and asynchronous cancellation/completion. Milestone 1 remains incomplete; its intended Discord workflow is user-started capture during manual scrolling, followed by an explicit summary request.
