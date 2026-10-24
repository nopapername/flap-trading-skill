# Validation — v0.1.10

Graduated sell dispatch: sell CONFIG selects internal shares or actual deployed wallet tokens→BNB. Pinned token identity/code/balance/decimals and claimableProbe separate actual tokens, claimable token quantity, historical shares and unknown claim state. No automatic claim. Mixed holdings sell only actual tokens. EXIT_V1 freezes original market/percentage/raw quantity; submitted outcomes never reroute or resubmit. Existing internal and standalone exits remain compatible.

Source suite **260/260** and clean installed release artifact **260/260**. Packaged first-use acceptance **22/22**, walletMutations=0. Local personal-tool compatibility **66/66** with serial test execution; the initial concurrent run hit an existing 10ms lock-test scheduling assumption under load, and the isolated serial run passed without changing lock implementation. Independent review found two reporting gaps (historical shares vs claimable state and missing graduated native-proof repair); both were fixed with failing regressions and the focused re-review passed 38/38 with no remaining blockers. Final full suite also includes negative canonical block/hash/Gas and initial nonce-anchor reorg coverage.

New coverage includes fractional/exact raw sale input; unclaimed-only prompt, claimed historical shares and unreadable claim state; mixed actual/claimable assets; migration/identity/code rejection; pending replay and never-submitted resume with frozen quantities; legacy venue preservation and revoked conversion permission; dispatcher+real EXIT engine recovery via synthetic wallet; receipt-backed token basis/decimals/PnL; unknown extra approval Gas; canonical read-only native proceeds repair updating operation, cash, market-sale summary and token sale atomically. Missing cost/claim/native/fee evidence remains unknown. Complete fee inference requires the initial nonce block anchor to remain canonical and swap nonce to match; otherwise net PnL stays unknown.

Release scan **88 files**, Skill validation and package/source byte equality **89 files** passed. Clean dependencies installed offline with lifecycle scripts disabled. All development and testing used `FLAP_READ_ONLY=1`, synthetic execution adapters and local read-only RPC/wallet fixtures. No real App login, settings change, claim, signature, approval, buy, sell or swap. These tests do not establish real-funds execution or latency guarantees.

# Validation — v0.1.9

Default trading rules v3 adds --auto-sale-to-bnb after an explicit human sell request, using existing SALE_BNB_V1 execution and recovery. Earlier/custom policies do not gain conversion permissions on upgrade. Reporting instructions require fresh wallet balances, all current holdings and applicable actual PnL after every completed trade; unavailable evidence stays unknown and buy valuation is not realized profit.

Source and clean installed artifact suites: **240/240** each. Packaged first-use acceptance: **22/22**, walletMutations=0. Added coverage verifies exact sale proceeds conversion leaves pre-existing quote inventory unchanged even after duplicate/recovery replay. First-use v3 permission mapping retains separate explicit sell confirmation and no automatic sale timing/claim. Detached portfolio-worker integration verifies current BNB balance, holdings/PnL columns and receipt-bound block in CLI text plus saved snapshot. Existing tests cover sale/conversion interruption, partial dust without retry and evidence-bounded realized PnL.

Skill validation, release scan (86 files), artifact/source byte comparison (87 files) passed. All implementation/testing used `FLAP_READ_ONLY=1` with synthetic execution adapters and local read-only RPC/wallet fixtures. No real login, wallet settings change, signature, approval, sale, swap or trade. Documentation-to-flags mapping is explicit fixture setup, not an independent AI-client conversation or real-funds execution test. Reporting of other quote balances still requires verified read-only chain evidence; ledger balances are not claimed as current wallet holdings.

# Validation — v0.1.8

Default trading rules v2 maps explicitly accepted audit-unavailable continuation to existing --ack-audit-unavailable. This changes the documented profile, not the execution engine or implicit policy defaults. Existing v1/custom policies remain unchanged.

Clean installed tarball suite **239/239**. Additional isolated CLI/policy/audit smoke checks **7/7**: persist the v2 flags, allow missing audit and unavailable service, disclose absent evidence without a risk rating, block actual risk hits/high risk/abnormal tax/unreadable available audit, retain read-only execution block, and keep old unacknowledged policies unchanged and blocked on missing audit. No real wallet commands in the smoke checks. Profile-to-CLI mapping is explicit test setup, not an independent natural-language conversation test.

Skill validation, release scan (86 files), source/artifact byte comparison passed. All tests used `FLAP_READ_ONLY=1` with injected fetch/wallet fixtures; no real login, approvals, signatures or trades. No claim of guaranteed real-funds execution or latency.

# Validation — v0.1.7

Explicitly selected default trading rules profile is mapped by the Skill to existing quote-conversion/direct flags; audit-unavailable stop and unselected sale/claim permissions remain unchanged. The README short prompt retains personal budget, slippage and automatic CONFIG-buy authorization. No engine or stored-policy defaults changed.

Clean tarball installed with offline locked dependencies and lifecycle scripts disabled: **239/239** tests passed, including first-use fixtures, permission decisions, budget/slippage enforcement and fake adapter continuity. Skill validation and source scan passed (86 files); packaged bytes match source. All checks used `FLAP_READ_ONLY=1`. No real authentication, wallet setting change or trade; natural-language profile selection was reviewed in instructions, not independently tested in another AI client.

# Validation — v0.1.6

Onboarding documentation update: README combines installation and first configuration into one editable user message; SKILL/setup reuse explicit rules and ask only for missing choices. No transaction logic or permission defaults changed; CLI version metadata updated.

Fresh first-use acceptance: **20/20**, walletMutations=0. Release tarball installed into a clean temporary directory with offline locked dependencies and lifecycle scripts disabled; packaged suite **239/239**. Skill frontmatter validation and release source scan passed (86 files; runtime state excluded). Packaged file bytes were compared against the source tree. All checks used `FLAP_READ_ONLY=1` and synthetic wallet/RPC fixtures. No real App login, developer-mode change, approvals, signatures or trades; AI conversation quality and real-funds execution are not established by these fixture tests.

# Validation — v0.1.5

Source and clean installed package: **239/239** each. First-use CLI acceptance: **20/20**, walletMutations=0. Personal tool compatibility: **66/66**. All implementation/testing ran with `FLAP_READ_ONLY=1`; no real sale, conversion, signature, approval or wallet settings change. Independent review passed after fixes for raw quote amount/decimals, PREPARING recovery, isolated proceeds basis, aggregate unknowns, canonical re-inclusion proof and interrupted v0.1.4 sale recovery. CI remains a template; checks are local.

Coverage includes exact current-sale proceeds conversion, no pre-existing quote sweep, at-most-once child effects, sale/exit interruption recovery, partial refunds, invalid parent bindings, mutable decimals, transaction trace bounds/delegatecall/revert semantics, canonical cache bypass, insufficient proof preserving unknowns, original block/hash/Gas binding, separate quote basis and current-sale/historical reports. Source token code/balance/decimals/symbol use one pinned batch instead of sequential reads. Live speed was not measured.

# Validation — v0.1.4

Source suite: **207/207**. Clean release tarball installed using offline locked dependencies: **207/207**. Separate first-use CLI acceptance: **18/18**, walletMutations=0. Personal-tool compatibility: **66/66**. Skill validation and release source scan passed (75 files; runtime data excluded). Independent review found no remaining blockers after atomic job publication and crash/concurrent recovery fixes. GitHub-hosted CI remains unenabled; these are local checks.

All release development and testing used `FLAP_READ_ONLY=1`, synthetic execution boundaries and local read-only wallet/RPC doubles. No new approvals, signatures, trades, transfers, sales, claims or wallet setting changes.

Deterministic read-count regressions: predicted-address mapping 2→1 transport batches; market bindings 5→1; ERC20 metadata 2→1; resolver→route full snapshots 2→1; existing quote assess→plan snapshots 2→1; sell assess→plan snapshots 2→1. This measures eliminated reads, not a live transaction speed guarantee. Funding/approval still force a fresh plan and private contexts expire after 15 seconds measured before reads.

Portfolio tests cover confirmed-only durable/idempotent enqueue, separate statistics and wallet queues, failed statistics read-only resume, minimum receipt block, duplicate workers, orphan statistics locks, immutable concurrent recovery generations, and a real detached worker with the CLI against a local read-only RPC fixture. First-use recovery now waits on its actual queued all-market snapshot and verifies exact basis.

# Validation — v0.1.3

Source suite: 190/190. Includes 13 archive-pool tests (availability switching, wrong chain/head, execution-revert refusal, budgets, cooldown, immutable-cache isolation, singleflight, null/pending behavior and credential redaction) and six automatic-reconciliation tests (repair, skip, backoff, evidence changes, dry runs and concurrent ledger protection). Canonical history proof regressions remain unchanged in behavior.

Read-only historical replay in an isolated pre-repair state automatically recovered the same exact purchase basis as the independently verified manual reconciliation, with no proof warnings; the next pass skipped archive work. This replay used public archival reads and existing confirmed records, not new transactions. Personal inputs, wallet addresses, hashes and amounts are not included in the release. Source validation and release scan passed (71 checked files); independent review passed. Clean packaged tests: 190/190 after isolated unpack and locked dependency installation. Synthetic first-use acceptance: 17/17, walletMutations=0. Personal-tool compatibility tests: 66/66.

No wallet transactions, signatures, approvals, transfers, claims, sells or settings changes were performed during this update. Automatic reconciliation runs only during online portfolio refresh and retains unknowns when evidence is missing. GitHub-hosted CI remains unenabled; reported checks are local.

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
