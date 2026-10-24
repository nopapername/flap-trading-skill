# First-use acceptance — v0.1.1, 2026-10-24

## What was actually tested

| Area | Evidence | Result |
|---|---|---|
| Released installation baseline | Downloaded v0.1.0 from GitHub and verified SHA256SUMS | PASS |
| AI skill installation | Standard Skill installer installed the tagged repository into an isolated temporary skill directory | PASS |
| Locked dependencies | npm ci with lifecycle scripts disabled, in clean temporary directories | PASS |
| Official wallet CLI dependency | Installed @binance/agentic-wallet1.11.0 into a temporary prefix; ran --version only | PASS |
| Simplified first use | Independent review of README → Skill → setup; no user terminal commands required in the main path | PASS |
| User state isolation | No existing policy inherited; synthetic wallet used; optional permissions stay off unless selected | PASS |
| CONFIG/CA input | Native predicted CA, CONFIG file, pasted CONFIG match; ERC20 quote/decimals checked; unknown CA stops | PASS |
| Real public-chain discovery | Supplied public NVDAB market resolves consistently from predicted CA and CONFIG, using a placeholder sender | PASS |
| Holdings | Empty initial ledger; full CA, synthetic name, exact shares and cost after fixture receipt recovery; offline reload | PASS |
| Recovery | UNKNOWN native request imports once; pending funding stays pending; confirmed funding credits once and stops at FUNDED | PASS |
| Auto-mode policy and engine | One-time test authorization drives fake conversion → finite approval → preview → buy with no chat checkpoint; repeated CONFIG submits nothing new | PASS |
| Conversion opt-out race | Engine and wallet adapter reject unapproved conversion even if balance changed after the entry check | PASS |
| Execution isolation | CLI acceptance wallet double allows only version/status/address/settings reads/order listing; mutations0 | PASS |

`node scripts/acceptance.mjs` contains17 subprocess/policy checks. The full suite contains135 passing tests, including injected execution-engine tests. The acceptance RPC is a loopback fixture server, deliberately returns reordered batch responses and refuses unknown/write methods. No developer wallet, credentials, personal ledger or real pending order was imported.

The packaged v0.1.1 artifact is also installed and tested in a new temporary directory before publication. See release notes for final artifact checksums.

## Boundaries

No actual App QR sign-in, developer-mode change, token approval, swap, buy, sell, signature, transfer or blockchain broadcast was performed. The auto-mode execution test uses fake adapters; it does not invoke a real live CLI purchase. Real-chain validation is discovery/read-only only. Therefore these results establish installation, parsing, policy decisions, simulated continuity, bookkeeping and recovery behavior, not real-funds execution success or a latency guarantee.

The Skill still honors wallet-required App confirmation, risk checks and unknown-output handling. Auto-mode never grants additional funding, direct routes, audit exceptions, selling or claiming by implication.
