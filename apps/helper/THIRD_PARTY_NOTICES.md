# Third-party notices

This source experiment retains each component's licence independently. The application's `UNLICENSED` metadata does not replace any upstream licence or grant.

- The unmodified OpenAI Sign in with ChatGPT DevKit files are from commit `0a36fefeb913055c8c7a1a29b63d82b96b2e841a`. Copyright 2026 OpenAI. See [its noncommercial licence](vendor/devkit/LICENSE), [original notices](vendor/devkit/THIRD_PARTY_NOTICES.md) and [dependency inventory](vendor/devkit/docs/dependency-inventory.json). The copied inventory describes upstream's whole repository; this experiment uses only its local Node SDK.
- `@primno/dpapi` 2.0.1 is MIT, copyright 2023 Xavier Monin. Its native implementation credits Brad Hughes and Microsoft's N-API port; the native source includes Microsoft's MIT copyright notice. See [DPAPI licence](licenses/@primno/dpapi/LICENSE) and [native attribution](licenses/@primno/dpapi/NATIVE_ATTRIBUTION.txt).
- `openai` 7.21.0 is Apache-2.0. Its separately licensed vendored parser/schema/query-string code retains the bundled licence copies under [licenses/openai](licenses/openai).
- `jose` 6.2.12, `proper-lockfile` 4.1.2, `retry` 0.12.0, `node-gyp-build` 4.8.4, Node type declarations and `undici-types` are MIT. `graceful-fs` 4.2.11 and `signal-exit` 3.0.7 are ISC. TypeScript 7.0.2 and its Windows native compiler are Apache-2.0.

Installed dependency licence/notice files are copied in `licenses/`, with paths listed in [INDEX.json](licenses/INDEX.json). The [root package-lock.json](../../package-lock.json) records the exact versions, registry integrity values and licence metadata, including platform-specific optional compiler packages. Keep the original package notices if redistributing installed dependencies; run `npm ci` from the repository root (its `.npmrc` disables dependency install scripts) to retrieve the locked originals. No fonts, visual branding assets or Electron application are shipped in this source checkout.
