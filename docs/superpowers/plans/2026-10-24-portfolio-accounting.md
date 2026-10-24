# Portfolio accounting implementation plan

Goal: provide evidence-based estimated exit Gas, reconcile provable historical basis, and separate zero balances into historical holdings. All development, queries and tests use FLAP_READ_ONLY=1; no wallet mutations. Publish a tested patch release without personal records.

Architecture: retain unknowns when evidence is missing. Reprice canonical wallet DEX receipt Gas at the current chain Gas price with an explicit 25% estimation margin; include separately simulated finite ERC20 approval Gas. These are labelled historical estimates, never route guarantees. Actual internal-sale Gas still comes from pinned read-only simulation. Retain current and historical rows in saved snapshots and offline reports. Enrich funding chronology only after canonical receipt verification and repair cost only if inventory and consumption can be proved.

- [x] Add failing tests for estimate provenance, stale/invalid receipts, approval cost, missing evidence, current/history partition and offline persistence.
- [x] Implement read-only exit estimator, partition/rendering, historical reconciliation and CLI query command.
- [x] Validate real portfolio read-only; retain precise reasons for unresolved history.
- [x] Run full source and packaged tests, synthetic installation acceptance, release scan and independent review.
- [ ] Publish GitHub patch release and checksum verified install package.
