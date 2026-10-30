# Echo — incident 2026-10-26/27 and zero-subscription recovery

## Verified Railway production evidence
- 2026-10-26 14:32:24 UTC: five websocket subscriptions acknowledged, websocketReady=true, reconnects=0, rpcFailures=0.
- 2026-10-26 14:33:23 UTC: subscriptions=0, websocketReady=false, reconnects=5, first visible 429 getSignaturesForAddress.
- 2026-10-27 08:02 UTC: websocketReady briefly returned true (5 subscriptions) despite accumulated RPC failures. It dropped again before 08:03 UTC.
- 2026-10-27 16:21 UTC: subscriptions=0, reconnects=2122, repeated 429 history RPC. No newly recorded buyer alert during the user's 16:02-16:21 UTC observation window.
- Cumulative 16190 parsed transactions yielded 221 accepted signals; 13695 unsupported program/instruction, 2274 watched wallet not signer, 163 queue drops and over 1000 RPC failures.
- This correlates with exhausted/throttled provider capacity but does not prove which provider limit or billing dimension triggered the outage.

## Changes prepared on draft PR
- Two configured callers: Slingoor premium and previously monitored Chairman research; unknown/uncorroborated wallets excluded. Historical records preserved.
- Cheap log prefilter avoids full RPC reads for non-trading wallet mentions. Supports known Pump.fun, PumpSwap, Jupiter, Raydium, Orca, Meteora, BisonFi log patterns; unknown Anchor trade hints pass to RPC for verification.
- Prioritize Slingoor live WebSocket candidates over history backlog.
- Persist queue signatures to existing /data volume, with retry on transient RPC failures.
- Exponential cooldown for history 429 and less aggressive history polling.
- Detect Jupiter v6 single-route net-input/net-output buys (signer + actual asset debit + token credit) in addition to Pump instruction decoding; token transfers are not buys.
- Expose safe websocket disconnect reason, acknowledged subscription count and candidate/skipped event counts in health.
- Live auto-buy remains hard disabled; manual sell only, no live trades.

## Provider verification before deployment
1. Open existing RPC/WebSocket endpoint's **Metrics / Endpoint Logs** for 2026-10-26 14:30-14:40 UTC.
2. Determine whether 429 means RPS, method cap, API credits/second, monthly allowance, concurrent WebSockets or specific subscription rejection.
3. Confirm provider credentials and both WSS and HTTPS endpoints remain valid without sharing access tokens.
4. Do not buy a provider subscription just to test; if existing plan is exhausted or restrictive, evaluate existing Helius free credentials in a separate no-trading alert-only probe, with user approval for any config change.
5. Deploy only after passing CI and obtaining explicit user approval; confirm subscriptions=2, websocketReady=true, no escalating reconnects, actual Slingoor BUY alert, and no alert on an incoming transfer.
6. Measure per-transaction delay, reconcile misses against independent explorer history and verify actual Jupiter signature used as regression fixture. Program coverage is not universal; do not claim 100% detection.
7. On reconnect, monitor backlog size and provider credits. Restarting blindly while the provider is still throttling can increase load and does not restore a broken subscription.

## Security / spending
No provider keys logged. No paid Birdeye API. No execution, auto-buy or auto-sell; static admission policy remains OFF.
