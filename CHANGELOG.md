# 0.1.11

- After installation/setup and verified wallet connection, query and display the current BNB balance with snapshot time; failed reads remain unknown.
- Keep routine post-sale chat reports focused on BNB balance, remaining market holdings and applicable realized PnL. Retain residual quote-token balances in local snapshots/accounting and disclose them on request or actionable conversion exceptions, without sweeping funds.
- Documentation and version metadata only; execution engines and authorization defaults are unchanged. Validation uses read-only fixtures only.

# 0.1.10

- Add a sell dispatcher: internal market sale retains the existing proceeds-only conversion; graduated deployed wallet tokens exit directly to BNB with exact percentage/decimals. Unclaimed-only shares prompt without any claim, mixed holdings sell only actual tokens.
- Persist market-bound EXIT_V1 intent, venue and quantity. Resume only never-submitted preparation, recover submitted orders without resubmission; legacy internal/standalone exit intents stay compatible and revoked conversion permissions remain enforced.
- Attach receipt-backed token quantities, conservative proportional basis, actual native proceeds and realized PnL to the post-trade wallet/holdings report. Missing claim/basis or approval Gas coverage remains unknown.
- Read pinned claimable state rather than treating historical shares as unclaimed; repair missing graduated native proceeds atomically in the existing bounded read-only archive worker.
- All release tests use read-only fixtures and simulated execution; no real trading or claiming.

# 0.1.9

- Default trading rules v3 explicitly includes current-sale-proceeds-only conversion to BNB after a human sell request, via existing --auto-sale-to-bnb; pre-existing quote inventory and earlier policies remain unchanged.
- Require each completed trade report to include fresh wallet balance, all current holdings and applicable realized PnL with snapshot time. Unknown cost/proceeds stay unknown; unrealized buy valuation is not actual profit.
- Extend first-use permission checks and regression coverage for pre-existing quote inventory across sale conversion and duplicate replay. Reuse the existing durable sale/conversion engines; no real transactions during validation.

# 0.1.8

- Default trading rules v2, when explicitly selected, include standing acknowledgment to continue buying when audit data is unavailable, without another confirmation. Map it to the existing --ack-audit-unavailable flag; disclose missing data rather than inventing a risk rating.
- Preserve concrete risk/tax/available-audit validation, simulations, funding limits and unknown-operation recovery. Existing v1 or custom policies never gain permissions merely by upgrading.
- Instruction/profile update with version metadata; no execution engine or underlying permission-default changes. No real trades during validation.

# 0.1.7

- Shorten onboarding by offering an explicitly selected default trading rules profile: budget-bound quote funding and verified BNB direct buying, audit-unavailable stop, reuse of already stated choices.
- Map the chosen profile to existing finite policy flags. Installation alone never enables permissions; explicit opt-outs prevail, existing policies remain unchanged, and budget/slippage/auto-buy authorization are still required.
- Instruction-only change plus version metadata; no transaction engine or permission-default changes. Read-only fixture validation only.

# 0.1.6

- Merge installation and initial configuration into one editable user prompt; continue through dependency checks, wallet connection and authorized policy persistence without asking users to repeat rules.
- Reuse explicit choices, collect only missing choices once, and report the verified wallet and saved permissions before accepting the next CONFIG. App confirmation remains required; examples do not authorize trading.
- Documentation/onboarding update only; transaction execution and permission defaults are unchanged. Release validation uses read-only fixtures, not real trades.

# 0.1.5

- Add separately authorized explicit sale→BNB workflow with fixed child intents, exact current-sale proceeds conversion, no pre-existing balance sweep or automatic retry.
- Batch pinned source token reads; keep simulations, risk, receipt and fresh execution checks. Recover provably unsubmitted stages and legacy interrupted sales without duplicate submission.
- Prove actual native output with bounded transaction traces and canonical checks; missing data remains unknown, bounded archive repair runs in background.
- Isolate sale proceeds cost lots, deduct all Gas once, show current sale realized PnL alongside all holdings and update fully covered historical rows.
- Read-only/offline validation only; no real transactions for this release.

# 0.1.4

- Batch independent resolver bindings/metadata reads and reuse private, wallet/config/RPC-bound initial snapshots for up to 15 seconds. Existing quote-balance and sell planning avoid duplicate assessments; funding/approval paths refresh again.
- Return confirmed outcomes immediately; persist deterministic portfolio jobs and run all-market statistics/archive repair in a separate forced-read-only worker. Add `portfolio-job` query/wait/resume, atomic job publication and dead statistics/recovery process handling.
- Preserve maximum permitted internal shares, <=1 BNB principal, finite approval, authorized slippage, simulations, freshness, canonical receipts and no financial resubmission. No real transactions during release validation.

# 0.1.3

Automatically reconcile unknown ERC20 purchase basis during portfolio refresh using verified, bounded read-only archive RPC failover. Add the tested public NodeReal/Blockmachine/Alchemy sources, chain and frozen-head binding, availability-only switching, per-run immutable read cache, failure cooldown and atomic concurrent-ledger protection. Diagnostics hide custom RPC credentials, including credential-bearing hostnames. Known costs and offline reports skip archive work; missing proofs remain unknown. Trading execution and wallet submission/retry behavior are unchanged. Validation uses offline fixtures and read-only historical replay, never real trades.

# 0.1.2

Separate verified zero balances into historical holdings in live, JSON and offline snapshots. Add provenance-labelled exit Gas estimates using recent canonical wallet token-call receipts repriced at current Gas with explicit margin and approval provision. Add bounded read-only historical funding/pooled-basis reconciliation with canonical receipts, balance anchors, transfer coverage and finite approval proof. Missing evidence continues to show unknown, including unresolved native cash proceeds. No real wallet mutations during this release's implementation or validation.

# 0.1.1

Simplified first-use experience: AI installs, collects one-time wallet/policy choices, then handles CONFIG/CA input continuously. Technical commands moved to advanced reference; added skill UI metadata and reproducible subprocess CLI acceptance with strict read-only wallet/RPC doubles. Funding conversion consent is checked again at the actual decision and submission boundary. No real transactions during validation.

# 0.1.0

Initial community distribution: verified CA/CONFIG resolution, per-user policy, bounded native/ERC20/direct buying, explicit sell/exit, durable recovery, partial refund handling and exact cost allocation. New distribution tested with offline execution adapters and read-only RPC only. Native cash reconciliation remains evidence-dependent; no full-history index or automatic claim.
