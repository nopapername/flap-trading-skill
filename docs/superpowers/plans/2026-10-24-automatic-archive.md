# Automatic archive reconciliation

Goal: automatically recover provable historical purchase basis during portfolio refresh, with read-only RPC failover and bounded work. Preserve the existing trading path and all canonical/inventory/approval proof checks. Keep unknowns when proof is incomplete.

Implementation:
- Add a read-only archive pool with the verified public NodeReal, Blockmachine and Alchemy endpoints. Pin the primary head and validate chain/head agreement on fallback nodes. Retry only read availability failures, never wallet actions or execution reverts; cache immutable reads in memory and enforce call/time bounds.
- Add automatic reconciliation before portfolio snapshots only when wallet ERC20 purchase costs are unknown. Save verified local repairs atomically; reject stale ledger results. Back off unchanged failures for five minutes, retry immediately on changed evidence, permit forced manual reconciliation. Skip network work when basis is already known and on offline reports.
- Keep post-trade execution independent of archive failures. Report explicit unknowns and sanitized diagnostics. Never store RPC credentials or personal state in the release.
- Add failing-first unit and synthetic installation tests, read-only historical replay, source/package validation and independent review. Publish v0.1.3 after checks.

All implementation and tests use FLAP_READ_ONLY=1. No real buys, sells, swaps, approvals, signing, transfers, claims or setting changes.

Implementation complete: source tests 190/190, read-only historical replay exact and warning-free, known-cost retry skipped, independent review passed. Release validation checks the clean package and synthetic first-use flow separately.
