# AlphaOS Subscription Feature & Data Contract

Status: LOCKED FOR PRE-SUBSCRIPTION VALIDATION

AlphaOS does not enable paid subscriptions until each promised production feature is BUILT and PROVEN end-to-end with genuine production events.

## Accuracy contract

Every important field must internally retain:
- value
- source
- observed_at
- confidence: VERIFIED | ESTIMATED | UNVERIFIED | UNAVAILABLE

Rules:
- Missing or failed lookups must never become numeric zero.
- Stale values must not be represented as current.
- Creator-supplied social links are metadata, not ownership verification.
- Derived classifications must remain distinguishable from directly verified on-chain facts.

## Resource-efficiency contract

This is a hard architectural requirement for every AlphaOS feature, scanner, enrichment path, subscription feature and future signal.

Default pattern:
- event-driven before polling-driven
- reuse an existing discovery event before adding another scanner
- fetch once, normalize once, cache once, then derive/classify multiple signals locally
- parallelize independent enrichment only after a meaningful candidate exists
- use launchpad guarantees only after factory/origin verification; do not repeat expensive checks already guaranteed by that exact trusted launch contract/version
- direct/custom/unknown launches still require the hard security gate
- persist meaningful state changes/events rather than every observation
- deduplicate before expensive enrichment and before Telegram delivery
- reuse normalized snapshots across security, formatting, entitlement and outcome tracking
- never create separate scanners for FREE/PRO/ADMIN; entitlement controls delivery of the same canonical event
- use bounded retries/backoff for provider/RPC failures; no hot retry loops
- prefer cached/fresh-enough market and metadata values when a new remote call would not change the decision
- outcome checkpoints should be scheduled from persisted signals, not continuous per-token polling
- optional/social enrichment must not delay a security-cleared time-sensitive alert; it may update the same message later when worthwhile

A new worker, recurring poll, external API call, RPC call or database write must have a clear reason that cannot be satisfied by an existing event/snapshot/cache. Server/provider cost is part of the release gate.

## Common opportunity snapshot

All opportunity engines should capture the same normalized snapshot where available.

### Identity
- chain
- token_address
- name
- symbol
- launch_source: PONS | VERIFIED_LAUNCHPAD | DIRECT_DEX | UNKNOWN
- launchpad_name
- launch_factory
- launched_at
- token_age_seconds

### Market
- price_usd
- market_cap_usd
- fdv_usd
- liquidity_usd
- volume_5m_usd
- buys_5m
- sells_5m
- buy_sell_ratio
- chart_url

### Developer
- deployer_address
- initial_dev_holding_percent
- current_dev_holding_percent
- dev_sold
- dev_transferred
- dev_burn_percent
- dev_last_movement_at

### Safety
- contract_exists
- honeypot_status
- sellability_status
- transfer_restriction_status
- liquidity_protection_status
- liquidity_protected_percent
- holder_concentration
- connected_wallet_risk

### Social/navigation
- launchpad_url
- project_url
- twitter_url
- telegram_url
- explorer_url

### Signal
- signal_id
- signal_type
- detected_at
- detection_market_cap_usd
- detection_price_usd
- reason_codes
- confidence

## BOOST Intelligence

BOOST is ecosystem-wide, not PONS-only.

Subtypes:
- BOOST_DETECTED
- BOOST_INCREASED
- MAX_BOOST_500_PLUS

Classification/enrichment:
- PONS BOOST
- other verified launchpad BOOST
- direct DEX/custom-token BOOST
- unknown-source BOOST

Required BOOST fields:
- boost_added
- total_active_boost
- all common identity/market/developer/safety/navigation fields available at alert time

### BOOST security routing

Verified supported launchpad:
1. Verify factory/origin.
2. Apply only guarantees explicitly registered for that launchpad/version.
3. Do not repeat expensive checks already guaranteed by the verified launch contract.
4. Fetch market/dev/signal data in parallel.
5. Alert promptly.

Direct DEX/custom/unknown:
1. Contract must exist.
2. Sellability/honeypot check is mandatory.
3. Transfer restrictions must be checked where detectable.
4. Liquidity must be independently verified as protected/locked/burned according to policy.
5. Developer and holder risk are enriched in parallel.
6. Hard security failure suppresses subscriber opportunity alert.
7. Hard security unavailable/unverified must never be displayed as SAFE.

500+ boost prioritizes security processing but never bypasses the hard security gate.

## PONS Trend Reversal

Normal PONS opportunity alerts must not fire during the first 30 minutes.

After maturity, a reversal candidate requires:
- verified PONS origin
- age >= 30 minutes
- fresh positive/reversal curve evidence (not merely historical positive movement)
- verified developer still holding without suspicious token movement OR verified qualifying developer burn
- required market/safety enrichment

The alert must include common snapshot fields plus PONS-specific curve/reversal evidence and PONS navigation when available.

## Robinhood opportunity discovery

Must support:
- verified launchpad opportunities
- direct DEX/custom opportunities

Direct/custom opportunities use the same hard security gate as custom BOOST tokens.

## ARC

Must support:
- ARC opportunity/reversal
- ARC BOOST
- verified burn signals

Burn must never be reported as verified without confirmed burn evidence and required liquidity conditions.

## Smart Money

Pre-subscription validation starts as ADMIN/private intelligence.

Must capture:
- tracked wallet identity internally
- transaction hash
- BUY/SELL classification
- token
- amount/value
- entry price and market cap where available
- wallet performance metrics once AlphaOS has enough realized history
- independent-wallet/cluster status

Promised future subscriber events:
- SMART_MONEY_ENTRY
- MULTI_SMART_MONEY

Subscriber Smart Money may anonymize proprietary wallet identities (e.g. Alpha Wallet #17). Raw wallet database remains internal/admin.

## Developer / liquidity / risk alerts

Required event families:
- DEV_MOVEMENT
- DEV_SELL
- LIQUIDITY_REMOVAL
- LIQUIDITY_RISK
- VERIFIED_BURN
- HOLDER_ACCUMULATION / HOLDER_DISTRIBUTION where objectively supported
- RISK_EXIT_ALERT once underlying signals are proven

## Alpha Convergence

Do not build a convergence claim from unproven components.

ALPHA_CONVERGENCE may fire only when multiple independent, captured signals align. It must preserve the contributing signal IDs so the reason is auditable.

## Watchlist

Personal watchlist alerts reuse the same underlying normalized events. Do not create a separate scanner merely for subscription delivery.

## Outcome tracking

Every opportunity signal must be recordable regardless of whether it is delivered to a subscriber.

Capture at detection:
- signal_id
- signal_type
- token
- detected_at
- detection_price
- detection_market_cap

Outcome checkpoints target:
- +5m
- +15m
- +30m
- +1h
- +6h
- peak after signal
- maximum drawdown
- dev sold after signal
- liquidity failure/rug evidence
- graduation where relevant

Historical performance claims must be calculated from captured outcomes, not hand-selected examples.

## Future entitlement timing (not enabled yet)

When subscriptions are eventually enabled:
- ADMIN/internal: immediate
- PRO: approximately +5 seconds
- FREE: approximately +30 seconds

Public subscription material must never mention the internal ADMIN tier.

Risk/safety warnings should not be deliberately delayed for monetization.

## Release gate

Each feature has two states:
- BUILT: implementation exists.
- PROVEN: a genuine production event has traversed detection -> enrichment/security -> decision -> Telegram delivery with correct data.

Paid subscriptions remain disabled until the promised core feature set is proven and the displayed data matches this contract.

A feature is not release-ready if it creates avoidable polling, duplicate enrichment, hot retry loops, duplicate scanners, unnecessary database writes, or materially increases provider/server load without a justified decision-quality benefit.
