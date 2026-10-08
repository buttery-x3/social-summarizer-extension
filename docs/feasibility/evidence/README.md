# Preserved feasibility evidence

`FLAME-135-package-check.zip` preserves every tracked file from the original extracted attachment at commit `70ef1d6351bd76c48527cf9b986219bdc14bede2`, including its original README, locks, sources, tests and licence files. It replaces the duplicate source tree at `evidence/FLAME-135-package-check/`; it is historical evidence, not another active workspace or installation root. Original paths are retained inside the ZIP. Untracked dependencies, generated output and credentials are excluded.

- Archive SHA-256: `521be9234c55d370558e773760a1fffca6065ff4cfebe6f1ec3ac218dcdb13d5`.
- Original [tracked attachment tree](https://github.com/buttery-x3/social-summarizer-extension/tree/70ef1d6351bd76c48527cf9b986219bdc14bede2/evidence/FLAME-135-package-check).
- The original Linear-uploaded ZIP was a different container: its reported SHA-256 is `bfa1bc9f2f0a243c36fdf13855579547f79bc4c7b1384d3f76deb377f7aff2e4`. This archive does not claim to reproduce that container's bytes.

The prior [FLAME-134 results](../FLAME-134-results.md) retain their recorded versions/PIDs/timing. Original generated attachments remain available on the completed issues. Historical FLAME-135 live-test statements in the archive predate the later user confirmation; the [current write-up](../FLAME-135-chatgpt.md) reconciles that evidence.

`npm run test:chrome` writes ignored `chrome-live.json` and screenshots here. The recorded FLAME-136 rerun is preserved as `FLAME-136-chrome-live.json`. It contains native-transport results only, without account or credential data.

`FLAME-137-chrome-synthetic.json` records the integration's real Chrome/native/shared-client/SDK/DPAPI path with a **synthetic provider fetch boundary** and temporary synthetic credentials. Its summary strings intentionally include literal script markup to verify text rendering. This is not live account evidence. The integration commands write `FLAME-137-chrome-synthetic.json` or, after explicit authorisation, `FLAME-137-chrome-live.json`; screenshots are ignored. Current live status and limitations are in [FLAME-137](../FLAME-137-integration.md).
