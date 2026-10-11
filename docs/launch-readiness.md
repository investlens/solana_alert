# AlphaOS launch additions

Existing alerts retain eligibility, safety gates, preferences and 0/5/30-second release timing.
DEX-paid processing now runs in at most two background tasks, with duplicate token work suppressed. Scanner cycles do not await delayed recipients. Busy tokens are made due again. Existing watch limits/provider budgets remain; this does not promise immediate detection of every payment.

`/performance` and `/api/performance` read existing compact outcomes and aggregate coverage. No new database tables or scanner calls. Original alert timestamps unavailable on retained historical winners are clearly labelled. Pre-bond ratios are excluded from USD returns. Losing/incomplete/excluded outcomes remain visible through aggregate coverage; retention is unchanged.

Winner publisher is disabled by default. To enable, set ALPHA_X_PUBLISH_ENABLED=true, ALPHA_X_USER_ACCESS_TOKEN (OAuth user-context tweet.write/users.read), ALPHA_X_ACCOUNT_ID and ALPHA_PUBLIC_URL (HTTPS). Account identity is verified before sending. Atomic Redis claims last 30 days; ambiguous/rejected posts are not replayed automatically. Missing Redis withholds posting. Publisher errors do not interrupt Telegram. Existing runner gates still apply. Only same-pool USD checkpoints qualify. No pre-bond X winner claims yet. Current implementation publishes text evidence, not uploaded image cards. Existing Telegram image cards remain.

Holder verifier is prepared, not wired into billing or Telegram membership. Token contract, chain, decimals and threshold are unknown. Integrate authenticated Telegram identity, server-stored single-use wallet challenge, verified signature, live chain/balance reads and expiring entitlement rechecks before enabling. Never accept a client-provided challenge or grant perpetual access from a snapshot. Existing paid subscriptions remain untouched.

Activation blockers: X account/credentials/public deployment URL; token settings and authenticated wallet-link flow. Do not enable incomplete holder access.
