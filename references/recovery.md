# Recovery

`operations` lists persisted IDs, stages, hashes and order IDs. `recover ID` reads official order status and canonical receipts, records confirmed effects and never signs. For swap workflows (funding, direct buy, exit), an official matching `--order-id REAL_ID` is required; a bare transaction hash cannot establish the swap intent. Contract calls with frozen calldata can attach `--tx REAL_HASH`. Do not fabricate either identifier.

PREPARING, SUBMITTING, UNKNOWN, PENDING and CONFIRMED_UNREADABLE keep the wallet unavailable for a different intent. Finishing a submitted transaction is not retrying it. After ERC20 funding/approval is verified, continue the SAME buy ID with `buy INPUT --live --request SAME_ID --resume` and any confirmation required by policy. Do not resume a different CONFIG or budget. Explicitly failed intents are terminal; another attempt needs an explicit new user instruction and ID.

A new request ID must not be used to bypass uncertainty. Do not delete request records or stale locks before checking the recorded PID and all submitted effects. Back up local state first. Financial locks are never automatically removed. Statistics recovery may reclaim only statistics locks whose recorded process has exited.

For SELL_V1, recover a lost contract response using its transaction hash; order-ID-only App confirmation is not resolvable until a hash is available. EXIT_V1 uses official market-order status; hash-only recovery fails closed. FINISHED plus canonical successful receipt and actual source/token changes is required. A partial source spend with router refunds is a confirmed partial conversion, not an unsuccessful order: show the remaining balance; never repeatedly sell dust automatically.

## Post-trade portfolio jobs

A confirmed trade returns immediately with a durable `portfolio-queued` job ID. `portfolio-job ID --wait-ms 30000` reads that job and prints its actual all-market snapshot when complete. It never submits a trade. QUEUED/RUNNING is not a completed refresh; FAILED reports statistics failure separately from the confirmed transaction. Do not substitute an old portfolio table.

If the statistics worker exited or RPC recovered, use `portfolio-job ID --resume --wait-ms 30000`. This restarts statistics only; active workers are preserved, completed jobs reuse their snapshot, and dead worker/statistics/recovery locks are reclaimed only after PID checks. Incomplete or unreadable owner records fail closed for manual inspection. A host/client that kills detached children can leave QUEUED jobs; use this same read-only resume command. `portfolio` remains a synchronous explicit refresh, and `portfolio --offline` is explicitly a saved snapshot.

## SALE_BNB_V1

Always recover the parent ID. Read-only recovery settles linked sale/exit receipts but never submits an unstarted leg. After recovery shows PREPARING/EXIT_READY (or a provably unsubmitted PREPARING child), explicitly continue the same parent via `sell INPUT --live --confirm --request SAME_ID --resume`. An unknown/submitting leg is never replayed. A failed conversion preserves the confirmed sale, actual quote receipt and clear error; a fresh financial attempt needs a new explicit human instruction. Background portfolio/native-proof tasks can resume independently. Native proof repair checks original canonical block/hash/Gas; re-inclusion mismatches remain unknown.

## Graduated market sells

`sell CONFIG` inspects phase only for new requests. Deployed actual wallet tokens are frozen into a market-bound EXIT_V1 (exact raw amount, decimals, percentage and original CONFIG). Pending/unknown exits never switch back to internal sale or sell a newly increased balance. Use `recover ID --order-id REAL_ID [--tx HASH]` first; resume a provably unsubmitted PREPARING exit with the same CONFIG, percentage, slippage and ID via `sell ... --resume`. Missing order identity stays unknown, not a fresh order. Legacy SELL_V1/SALE_BNB_V1 requests keep their original route.

A pinned claimableProbe distinguishes actual claimable tokens from historical HELD_SHARES. BLOCKED_CLAIM_STATUS reports missing claim evidence, never assumes claimable quantity. BLOCKED_UNCLAIMED is a read-only prompt, not a submitted or pending trade. No claim is executed. Mixed positions sell only actual wallet tokens; unclaimed shares remain untouched. Unimported claim/basis evidence or unproven extra approval Gas keeps actual PnL unknown. Completed market exits enqueue the same read-only wallet/holdings/current-sale report.

Graduated EXIT native proceeds missing at confirmation can be repaired by later read-only portfolio refresh. Canonical block/hash/Gas must still match. Repairs update the operation, current-sale summary, cash settlement and matching token ledger sale atomically; unproven extra approval Gas keeps net PnL unknown.
