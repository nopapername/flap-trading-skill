# Validation — v0.1.1

Source and clean packaged-artifact suites:135/135. First-use acceptance:17 checks, no wallet mutations. Includes verified public CA/CONFIG discovery and fake adapter auto-mode/recovery coverage. No real trades or App login. See [full first-use report](first-use-acceptance.md). GitHub CI remains a template because workflow scope is unavailable.

## Previous v0.1.0 validation

# Validation — 2026-10-24

- Source suite:131 passed,0 failed, using FLAP_READ_ONLY=1 and injected execution adapters.
- Packaged-artifact suite:131 passed,0 failed after offline npm ci in a new temporary directory.
- Skill Creator quick_validate: valid.
- Release source scan and npm file allowlist: passed; no runtime wallet state, authorization, personal ledger or credentials packaged. Protocol receipt fixtures were regenerated with synthetic addresses, hashes, amounts and coordinates.
- Live validation was read-only: predicted CA resolves through the official Factory/Probe/Reader, including native/ERC20 metadata and prelaunch predicted-vs-actual token semantics. Official application component SHA256 rechecked against protocol provenance.
- Clean init requires a new user's wallet/budget/slippage/mode; live buy under test-mode environment was rejected before opening a wallet.
- Independent review identified volatile intent metadata, missing market registration on first sale, direct-token exit basis, and hash-only swap recovery binding. Each was fixed with failing-then-passing regressions. Independent Skill forward walkthrough covered onboarding, auto scope, CA discovery, interrupted funding, recovery and unknown cash reporting.

Limits retained deliberately: complete native cash receipts require sufficient balance/trace evidence; reported output is never substituted. No complete external-history index, claim execution or automatic dust sale. Public protocol/CLI upgrades may require compatibility updates. No real transaction, approval, signature, transfer, sale or wallet-setting change was performed during implementation or testing.

GitHub workflow upload was rejected because the current OAuth token lacks workflow scope. A ready-to-enable template is distributed at docs/github-actions-test.yml; no GitHub-hosted CI success is claimed.
