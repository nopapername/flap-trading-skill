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
