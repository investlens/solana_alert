# Compact alert outcomes

Tracks confirmed Telegram-accepted positive alerts only. No discovered-token firehose, image, HTML or wallet-history storage. The first admitted alert owns the feed attribution; later boosts reuse the same chain/token session.

A database advisory lock caps active sessions at 20 across services. The existing PONS collector timer replaces the legacy launch-wide collector and claims at most two observations per minute, sequentially. Main/ARC services register accepted alerts; they do not start collectors. Checkpoints are 15 minutes, one hour and six hours; one retry per checkpoint, five-minute grace. Late/provider-missing data stays incomplete, never zero or a later backfill. Excluded-admission coverage is bounded and best effort, not a complete alert census.

The original chain, base token, pool and price unit must match. Indexed USD prices and native PONS raw ETH reserve ratios are separate series. Graduated curves are unavailable rather than switching to a different venue or currency. No FDV is substituted for market cap in outcome storage.

Classification uses three complete samples: WINNER requires six-hour price return >=25% and no sampled baseline return below -30%; FAILED requires final <=-50% or sampled baseline return <=-80%; otherwise NEUTRAL. Any missing sample makes the session INCOMPLETE. These are sampled gross price changes, not ATH, executable trade returns or full intraperiod drawdowns.

Finalization atomically archives winners, increments feed totals and verified-creator session totals, then marks the session finalized. Repeated leases cannot increment totals again. Creator attribution requires a factory-event/deployment source; social-profile claims are not sufficient. Unsupported/unverified creator attribution remains absent. Summary counts are assessed sessions, not a complete launch count, and losing outcomes do not establish fraud.

Finalized detail expires after seven days; winner archives, compact creator counts and daily feed totals remain. Legacy historical tables are untouched. RLS is enabled and public/authenticated access is revoked; these operational tables/RPCs are service-role-only.

Control: ALPHA_COMPACT_OUTCOMES_ENABLED defaults true. Setting false restores the legacy collector path; do not run both. Worker: existing pons-live-dev only. No new Railway service.

Validation: main typecheck and 579 tests; ARC typecheck and 15 focused tests. SQL rollback fixtures exercised capacity, dedup, leases, winner archive, incomplete classification, exactly-once finalization, failed creator totals after retention and public RPC denial. Fixtures leave no stored rows or Telegram messages.

## Bot views

Creator research cards expose Creator Outcomes; Track opens recorded 15m/1h/6h samples, and the Intelligence Track Record menu uses seven UTC calendar days of compact feed counts. Admin Performance adds active/overdue tracking health. These reads do not register sessions or poll market providers. Main bot uses bounded 100-entry caches (30 seconds for tokens/creators, 60 seconds for feeds/health), coalesces concurrent reads, permits at most two in flight and 20 logical lookups/minute, and pauses a minute on provider errors. Token lookup falls back to the permanent winner archive after detail expiry. Feed retrieval is capped at 128 daily rows, eight visible feed groups, with explicit partial-report labeling.

Creator and tracking views reuse intelligence.creators and watchlist.use capabilities respectively; performance uses its existing capability. Commercial billing remains closed, so current testers retain access. Future subscription activation will enforce those existing capability rules. None of these views claims a missing record means no launches or failure, or calls sampled high/low ATH or realized profits.
