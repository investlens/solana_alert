# Robinhood promotion outcome coverage

Boost and DEX Paid retain the existing delivery/security/recipient rules. This
measurement path starts only after confirmed Telegram acceptance; live delivery
never waits for it. No market, RPC or social-provider reads are added.

## Baseline evidence

The final stats object supplied to the initial promotion card renderer is copied
before fan-out. Outcome capture uses that exact quote, pool, source and unit,
not the earlier cache snapshot and not a later enrichment edit. A comparable USD
baseline requires a positive finite DEXScreener price and an exact Robinhood pool
URL; a checked sellability pool must match. Prebond PONS quotes and unverified
raw event prices never become DEX performance baselines.

The service-only `alpha_promotion_baselines` ledger stores one compact record per
accepted event identity: quote, pool, capture time, first Telegram acceptance,
coverage reason and token-tracker admission. New payment/Boost event identities
have separate baselines even for the same token. A retry cannot overwrite an
earlier acceptance; independently recovered earlier evidence can replace a later
acceptance. No historical quote or acceptance time is manufactured.

`reason` describes quote comparability. `admission` describes the existing token
tracker: REGISTERED, REUSED, LOCAL_REUSED, KNOWN_WINNER, NO_BASELINE, CAPACITY,
LOCAL_BUSY, COOLDOWN, RATE_LIMIT, DATABASE_UNAVAILABLE and other explicit statuses.
A missing quote can coexist with an existing token tracker; this does not make
that tracker's earlier quote the new promotion's baseline.

## Budgets and limits

- One serial post-send writer, up to ten pending events, five-minute expiry and
  sixty-second failure cooldown. Concurrent promotion admissions are serialized.
- Original token-tracker limits remain:20 registrations/minute,20 active tokens,
  two checkpoint measurements/minute, existing one active-runner peek/minute.
- One extra bounded database RPC per captured event. No per-recipient rows or
  message bodies, images, transactions or raw payloads are added by this ledger.
- Seven-day baseline retention; indexed cleanup deletes at most100 expired rows
  per write; hard capacity5000 rows. Failed/ambiguous writes retry idempotently
  on a later enqueue, never by replaying Telegram.
- RLS is enabled. Anon/authenticated have no table access or function execution.

This is baseline and admission coverage, not a new per-event sampling scheduler.
A later promotion reusing an existing tracker is not promised fresh15m/1h/6h
samples. Those observations must be compared by actual timestamps and venue/unit;
missing observations stay unmeasured. Capacity limits are never hidden by raising
provider load or by counting unknown outcomes as successes.
