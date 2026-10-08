# FLAME-135: Windows ChatGPT sign-in feasibility

A diagnostic CLI summarises one built-in invented transcript with an explicitly authorised ChatGPT plan. Its reusable auth/client modules now live in the helper workspace alongside the separate Native Messaging entry point. The two demonstrations remain unconnected. See the [workspace README](../../README.md) for current setup and [migration results](FLAME-136-workspaces.md) for newly rerun checks.

## Setup and commands

Use **Node 24.15.0**, npm **11.12.1**, Windows x64, and a ChatGPT account eligible for plan usage. Source and dependency versions are pinned below. From the repository root:

```powershell
npm ci
npm run build
npm run chatgpt -- sign-in
npm run chatgpt -- models
npm run chatgpt -- summary
```

For a current source export, extract it and enter its root before the npm commands. Root `.npmrc` disables dependency install scripts. The original FLAME-135 attachment's layout is preserved as [historical evidence](evidence/README.md); use the current root commands for this checkout. Dependencies use prebuilt binaries; installation does not need Electron, Python or Visual Studio on the tested Windows x64 runtime.

Complete **Continue with ChatGPT** in the default browser, choose your account/workspace, and allow ChatGPT plan use. A connected identity alone does not pass the proof. Only `Completed summary (...)` with nonempty text passes the inference portion.

Each command starts a new process. Verify restart and, only when intentionally disconnecting, clear behaviour with the sequence below. Credential clearing is not required by the workspace migration:

```powershell
npm run chatgpt -- status
npm run chatgpt -- summary
npm run chatgpt -- clear-local-credentials
npm run chatgpt -- status
npm run chatgpt -- summary  # Must fail with sign_in_required
```

`disconnect` and `clear-local-credentials` are aliases. They attempt remote session revocation and remove the selected profile's access, refresh and ID tokens. The encrypted client/account mapping remains for later sign-in; the nonsecret installation host ID remains stable. Remote revocation failure produces a nonzero exit and explains that local tokens were cleared. Disconnecting the app in ChatGPT Settings removes remote app access. See [accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Additional commands:

```powershell
npm run chatgpt -- profiles
npm run chatgpt -- select PROFILE_ID
npm run chatgpt -- sign-in --new
npm run chatgpt -- sign-in --consent
npm run chatgpt -- summary --model SLUG_FROM_MODELS
npm run chatgpt -- sign-in --timeout-ms 60000
npm test
npm run test:sdk
npm run typecheck
```

Use `sign-in --consent` only when choosing to enable or reconnect plan permission. Ctrl+C cancels sign-in or a request. The CLI normally allows five minutes; SDK refresh completion may continue briefly after cancellation so a rotated refresh token can be saved safely. Status reads, profile changes and revocation use the SDK's own bounded operations.

## Configuration and architecture

| Setting | Default | Purpose |
| --- | --- | --- |
| `CHATGPT_SPIKE_STORAGE_DIR` | `%LOCALAPPDATA%\SocialSummarizerChatGPTSpike` | Absolute dedicated data directory; use the same directory and Windows account on restart. Shared root directories and a symlink at the target are rejected. |
| `CHATGPT_SPIKE_PORT` | `0` | SDK selects a free IPv4 loopback port. An explicit integer from 1 to 65535 is also accepted. |
| `--timeout-ms` | `300000` | Sign-in/model/summary deadline, from 1 to 600000 milliseconds. |

The official flow supports local personal experiments. It dynamically registers the initial OAuth client; no pre-issued client ID, client secret or API key is needed. The issued client ID stays with its profile. The user confirmed prior live acceptance on 8 October 2026; account/workspace eligibility was not independently rerun during this source move. [Integration guide](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)

The SDK starts `http://127.0.0.1:<port>/auth/callback` before opening the browser, validates state, PKCE and signed identity, and closes the listener on return/cancellation. The path and host remain fixed while the port can change. `sendHostId: true` enables the persistent installation identifier. [Registration contract](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

`apps/helper/src/chatgpt/dpapi.ts` implements the required encryption interface without Electron. Each write gets a fresh AES-256-GCM key, protected by **CurrentUser DPAPI**. The encrypted payload authenticates the full header, DPAPI-wrapped key and nonce. No plaintext token or bare encryption key is written. The directory ACL allows only the current Windows SID and SYSTEM, inherited by new credential files. The SDK supplies atomic replacement and an interprocess lock around storage/refresh; two Windows processes were tested against one rotating synthetic refresh token.

Microsoft documents that DPAPI can occasionally succeed with corrupted output, so the authenticated envelope adds an independent integrity check. [CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata)

`apps/helper/src/chatgpt/client.ts` discovers visible account-specific models, preserves server order, and uses the selected slug. The SDK sends the public `/v1/responses` request with message-array input, `stream: true` and `store: false`. The wrapper prints no partial output and requires the SDK's completed result plus nonempty text. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)

The CLI prints safe SDK errors with status/code/request ID/response shape when supplied. It never prints raw API errors, tokens, stack traces or authorization URLs, and never switches billing paths. Interrupted/incomplete/failed streams fail. A damaged credential file is preserved; recover its original OS-backed storage rather than overwriting it. [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

The pinned SDK deliberately omits retained ID tokens from browser URLs to keep them out of opener process arguments; it verifies the returned subject against the saved profile instead. This differs from the current guide's suggested `id_token_hint`. The unmodified SDK's tests cover that choice. No browser-extension-only plan-use integration was found in the current [SIWC documentation index](https://developers.openai.com/siwc/llms.txt). Its documented OSS flow uses a local callback; ChatGPT plugin authentication in that index is a separate integration. An extension-only implementation remains unproven.

## Versions and licences

| Component | Pinned/tested version |
| --- | --- |
| Windows / architecture | `10.0.26300`, x64 |
| Node / npm | `24.15.0` / `11.12.1` |
| `@siwc/local` | `0.1.0`, DevKit commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a` |
| `@primno/dpapi` / `node-gyp-build` | `2.0.1` / `4.8.4` |
| `openai` / `jose` / `proper-lockfile` | `7.21.0` / `6.2.12` / `4.1.2` |
| TypeScript / Node types | `7.0.2` / `24.13.5` |

The npm registry returned 404 for `@siwc/local` on 8 October 2026. It is an upstream private workspace package, so its unmodified source, tests and build/notice files are vendored under `apps/helper/vendor/devkit` and installed as the helper's pinned local dependency. `UPSTREAM.json` records provenance and source hashes; builds verify those hashes. The SDK is Node-based, but the upstream Paste Perfect application is macOS-only. Local/synthetic Windows adapter operations were independently tested; the user subsequently confirmed live acceptance. Windows ARM64 remains unverified.

The user confirmed **personal noncommercial experimentation with no intended commercial application**. The [DevKit licence](../../apps/helper/vendor/devkit/LICENSE) is a noncommercial licence, not MIT/Apache: it excludes business product development/testing even without charging a fee, unless separately agreed with OpenAI. Preserve that licence and the [upstream notices](../../apps/helper/vendor/devkit/THIRD_PARTY_NOTICES.md); do not relicense upstream components under an application licence. The first-party source remains inspectable and `UNLICENSED`; the owner has not yet chosen an application licence, and consolidation grants no new redistribution rights. See [THIRD_PARTY_NOTICES.md](../../apps/helper/THIRD_PARTY_NOTICES.md) for dependency licence copies and attribution. Recheck purpose, service eligibility and licensing before any commercial milestone or distribution.

## Original automated evidence — 8 October 2026

These rows preserve the original FLAME-135 automated findings. On 8 October 2026 at 20:31 AEDT, the user subsequently commented [on FLAME-135](https://linear.app/flamehorn-games/issue/FLAME-135/feasibility-chatgpt-sign-in-and-text-summarisation-from-a-windows): "tested manually and reviewed confirmed live acceptance ✅". The issue was marked Done. No raw authentication output was retained, and the source move does not reopen that completed proof.

| Check | Result |
| --- | --- |
| Fresh locked dependency install, build, source-hash verification, TypeScript check | Passed on the versions above. |
| Windows DPAPI + SDK state restored in a separate process | Passed with synthetic credentials and real OS encryption; disk contains only protected payload. Directory/file ACLs verified. |
| Clear and restart | Passed with synthetic credentials, including simulated remote-revocation network failure; subsequent model request requires sign-in. |
| Competing refreshes | Two real Windows processes, real DPAPI storage, mocked token/model endpoints: one refresh rotation, both requests use the successor. |
| Loopback denial/cancellation/timeout and stable host ID | Real local HTTP callback; simulated provider/denied consent. Listener closes, bad state cannot consume the attempt. Passed. |
| Stream failures | Simulated SSE completion, abrupt EOF, failure/usage limit, incomplete and empty completion. Only nonempty completed output succeeds. Passed. |
| Corrupted storage | Authenticated envelope mutations/truncation rejected. Damaged SDK file preserved across process restart/sign-in attempt. Passed. |
| Test totals | Local suite: 10 passed. Unmodified SDK suite: 56 passed, 1 Unix-only permission/symlink test skipped. |
| Prior real browser sign-in + plan permission + completed summary | **User-confirmed live acceptance**, after the original automated report; not newly observed by this agent. |
| Prior real connection reused after restart; live clear behaviour | Covered by the user's general confirmation of the earlier issue's live acceptance; no detailed account output supplied. |
| Live refresh, revocation, usage limit, account/region policy, browser cancellation | **Untested live.** Refresh rotation/JWKS recovery/terminal auth errors are covered by mocked upstream tests. |

During FLAME-136, the user reran the migrated CLI and reported that summary fails because they are currently signed out, while the CLI appears functional. New automated helper tests passed, including real Windows DPAPI with synthetic credentials. Live sign-in, a completed invented-transcript summary and protected connection reuse after restart **remain outstanding for the reorganised checkout**. Prior user confirmation and new synthetic tests do not establish a post-migration live inference pass. The exact current commands are in the root README and migration results. No Discord, auth/summary Native Messaging operations, installer or Electron integration is included.
