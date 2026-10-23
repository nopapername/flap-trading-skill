# Flap Trading Skill Implementation Plan

Goal: independent installable skill with verified CA resolution, user-local policy, resumable trades and receipt-based settlement.
Architecture: adapt exact-integer engines behind portable CLI and verified resolver. Isolated nested repository excludes personal parent state.
Stack: Node22+, viem2.57.10, Binance baw1.11.0+.
Spec: user-approved enhanced design in this conversation.
Constraints: FLAP_READ_ONLY=1 throughout development; no real trading/signing/approvals. Chain56, <=1BNB, max5%slippage, no auto widening or duplicate submissions. New users grant their own authorization.
Review focus: duplicate messages/restarts; funded PREPARING intents; partial source refunds; data isolation; malicious input.

1. [x] Portable package, setup/doctor and authorization; test clean environment and readonly guard.
2. [x] Factory.marketOfToken resolver with Probe/Reader checks; test unsupported addresses, malicious URLs, quote mismatch.
3. [x] Operation list/resume and explicit sell/recover; test unknown/pending outcomes and exactly-once submission.
4. [x] Settlement/cost reconciliation; test conservation, unavailable evidence, actual refunds and fees.
5. [x] Skill/docs/CI/package smoke test, independent review, sanitized GitHub publish.

Validation: behavioral tests before new implementation; fake adapters only; readonly live resolver validation; npm pack allowlist/secret scan; install from clean artifact; independent skill scenarios.
Execution authorized by user. No repeat confirmation required. Final reviewer independently evaluates release.

Verification: source and artifact131/131; Skill validator valid; read-only real CA resolution successful. Independent review fixes covered RED->GREEN. Final publication pending remote verification. No real transactions during development.
