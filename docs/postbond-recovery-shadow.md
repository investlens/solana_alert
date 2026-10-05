# Post-bond recovery research pilot

Audit date: 2026-10-05. The production Trade Setup worker is active, checking up to 10 of 20 PONS candidates each minute, with 50 deferred admissions. Recent logs show repeated NO_OBSERVED_PULLBACK waits, not a delivery crash. Admission supports registered PONS V2 WETH/native curves; launch age is limited to two hours. This is partial coverage, not an all-token scanner.

The existing alert rule combines price and increasing quote reserve/liquidity. It does not establish volume demand or executable profit. Requiring total USD liquidity growth can also conflate price appreciation with new liquidity. Existing alerts and gates remain intact.

## Frozen shadow hypothesis: postbond-v1

Observe only DEX snapshots already read by the setup worker. Require fresh provider timestamps, positive price, liquidity and market cap, valid 5m/24h volume and transaction counts. Reject contradictory volume windows. Cached timestamps cannot count as new confirmations.

Require a pullback of at least 5% from an observed same-pool peak, followed by two observations 45–180 seconds apart with rising price and 5m volume, liquidity at least 98% of the preceding snapshot, at least three buys and more buys than sells. Recovery must reach 3% above the observed pullback low. These are unvalidated screening thresholds.

No new alerts, orders or creator/security conclusions are produced. Shadow candidates do not inherit safety from qualifying market data. Existing creator checks still govern existing Trade Setup delivery.

Track each signal until a reference price breaches the observed low or an observed one-hour horizon is reached. Report negative and positive reference returns, sampled extrema and an initial-DEX-observation comparison. Provider gaps and pool changes become INCOMPLETE, never a fabricated exit. A one-minute/two-minute sampling cadence misses intrainterval extrema and cannot reproduce execution.

## Resource limits and evidence

20 in-memory watches, 100 recent completed identities, two-hour watch lifetime and 24-hour identity expiry. Zero extra provider requests, database writes or services. Logs contain versioned signals, outcomes and aggregate counters; state resets on deployment/restart. This first diagnostic pilot is not a durable performance ledger and cannot measure net profit. PONS_RECOVERY_SHADOW_ENABLED=false disables it.

## Requirements before user-facing actionable setup

Verify chain/router quote coverage; model both entry and exit, gas, fees, price impact and delivery latency. Capture a durable bounded prospective ledger including incomplete observations. Compare frozen rules to a baseline over the same sample, and assess drawdown, losing streaks, coverage and opportunity count. Do not selectively retain winners or market reference returns as realised/net returns. ARC coverage and chain-general admission require separate validation.
