# Implementation plan

1. Native proceeds proof and ExitTrader: add bounded pure trace parser + canonical readonly proof, preserve unknown on unsupported RPC; RPC readonly trace allowlist; batch token reads at pinned block. TDD mocks, no network/wallet execution. Delegate isolated modules/tests.
2. SALE_BNB_V1 coordinator: parent-child intent validation, exact sale-proceeds-only conversion, at-most-once children, pending/failed/partial states, recovery without execution, frozen proven cost, realized summary. Tests fake engines including crash after sale/funding submission. CLI/policy opt-in/init + sell dispatch/recover/resume.
3. Portfolio/report: current sale actual output/gas/basis/net PnL; complete all-market table/history; background jobs after sale/conversion; readonly native proof reconciliation bounded outside trade queue. Native and ERC20 result tests.
4. Offline source/clean-package first-use/readonly tests, safety review, local tool integration. Update docs/install package; do not publish private data or claim live speed validation.
