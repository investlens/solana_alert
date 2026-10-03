# Trader tools: first production release

## User flow and access

Home → Free / Pro explains five free research tools and five Pro workspace features. Pro remains available to testers while SUBSCRIPTIONS_ENABLED=false; payment collection is not enabled by this release. Commercial free access excludes the new trade.readiness and monitoring.personal capabilities. Runtime capability checks protect both callbacks and outgoing personal-monitor notices. Personal tools require private chat; group scans offer research and private-bot promotion as before.

Scan a Robinchain contract → Readiness · Pro. Existing automatic cards keep their compact Chart / Full Intel and Track / Copy layout: Full Intel offers Readiness / Monitor. Readiness → Monitor 1h opts into monitoring; Intelligence → My Monitors lists expiry and stop buttons. Requested research does not auto-enroll users into private alerts or monitors.

## Market screening, not entry approval

Uses the existing governed DEXScreener Robinchain snapshot and caches it locally for 60s (100 results, two concurrent checks, ten new readiness checks/minute). No fresh wallet, holder or creator scanner is started. Fresh exact token/pool USD price and liquidity must be positive and no older than 120s. Future timestamps, mismatched tokens, missing pools and unavailable data fail closed to Watch.

Setup forming requires reported market cap, liquidity ≥$6K, five-minute volume ≥$3K, ≥40 reported buys, positive reported sells, buy/sell ratio ≥1.4, pair age ≥30m and positive reported one-hour movement. These are screening thresholds, not validated profitability criteria. No Entry conditions met label is produced: pullback, complete creator/holder risk and size-specific execution still need assessment. MC is not fabricated from FDV; unavailable zero-volume aggregates are not displayed as verified activity.

Only indexed Robinchain USD pools are monitored in this release. Pre-bond native reserve ratios are not compared with USD prices. ARC/Solana monitor coverage and verified creator-selling triggers are not implemented or advertised.

## Shared bounded monitoring

One Redis hash, ten token rows maximum; two tokens/user; ten subscribers/token. Baselines are fixed at the first monitor start (not the original automatic alert); joining a shared token uses that same baseline and remaining lifetime, which the activation response states. Repeated clicks cannot extend expiry or reset the baseline. One hour expiry; stop removes only the requesting subscriber and deletes an empty token. Storage TTL is 61 minutes after the last admission; every operation also prunes expired rows. No image/HTML/history tick storage and no Supabase schema or row writes.

Atomic Redis Lua admission and selection maintain global limits across process restarts and replicas. Select at most five token checks per rolling minute, one globally leased market request at a time, each token no sooner than two minutes after its previous attempt. Existing market cache/governor is reused; one low-priority deadline-bounded request per selected token. Redis failure suppresses admission and pauses worker attempts for 60s. No alternate local store bypasses the cap. Startup STORE_READY validates the real Redis script without market queries or Telegram messages.

Price ≤−15% or pool USD liquidity ≤−20% relative to the fixed baseline triggers a deterioration notice. Recovery above −10% resets each corresponding flag; thresholds use hysteresis. Unavailable/stale data and pool changes are distinct warnings, not inferred drops. Data gaps retain existing deterioration flags, so returning data alone cannot re-arm the same drop. Maximum three warning events/token/hour. Transition is recorded before delivery; ambiguous sends are not replayed, and there can be a missed notification after a crash between reservation and sending. Safety notices have no monetization delay. No automatic trades.

Checks are sampled: rapid dumps, intervening events and recovery can be missed. USD liquidity change does not establish an LP withdrawal, creator sale or cause. Warn text makes this distinction explicit. Existing compact 15m/1h/6h outcome tracking is independent and unchanged.

## Validation

592 main tests plus typecheck. scripts/validation/monitorAtomicLua.py executes the production script using local Lua 5.4 with Redis/cjson command shims (not a real Redis server); validates global/user capacity, in-flight lease, five/minute budget, stored-state dedup, recovery hysteresis, three-event ceiling, stop, expiry and TTL. Production STORE_READY and no store errors verify actual Redis Lua acceptance after deployment. No synthetic Telegram alerts or persisted test tokens are used.
