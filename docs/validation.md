# Validation — v0.1.2

Source suite: 171/171, including 30 historical proof regressions, four exit-Gas tests, current/history partition and offline migration. Release validation uses FLAP_READ_ONLY=1 and synthetic execution boundaries; no real transactions, signatures, approvals, transfers, sales or settings changes.

Independent review found missing approval expense could be read as zero and endpoint balances could miss external inventory replacement. Repairs require explicit allowance/expense proof and full owner token-transfer coverage through the actual confirmed buy, including same-block ordering. Regression tests cover both. Gas fallback verifies canonical receipt identity/coordinates and is labelled historical token-call estimation, not future route simulation.

Read-only runtime checks confirmed active/history separation and nonzero estimated exit Gas. Historical funding coordinates were verifiable, while an older position still lacked archival state; that basis correctly remained unknown with the RPC error recorded. Native historical exit cash remains unknown without complete receipt evidence. Personal wallet addresses, transaction records and runtime state are excluded from the release.

Clean packaged suite: 171/171 after isolated unpack and offline locked dependency install. Separate first-use acceptance: 17/17, walletMutations=0. Skill frontmatter validation and release source scan passed (66 checked files, runtime data excluded). GitHub-hosted CI remains unenabled; all reported checks are local.

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
