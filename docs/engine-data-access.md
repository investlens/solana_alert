# Engine data access and bounded coverage

Boost and DEX Paid trigger/security rules are unchanged.

## Explorer history

Set `ROBINHOOD_BLOCKSCOUT_API_KEY` (or `BLOCKSCOUT_API_KEY`) as a secret on the services that need explorer history. With no explicit custom base URL, the reader uses the official `https://api.blockscout.com/4663/api/v2` route and appends the key without logging it. An explicit custom base URL keeps precedence and receives no key. The existing one-request concurrency, eight-entry cache, 30-second TTL and 403/429 cooldown remain. A key is required for this route; code readiness does not prove provider access. Live RPC block fallback remains available while public explorer access is blocked.

Official reference: https://github.com/blockscout/docs/blob/main/robinhood-api.mdx

Valid explorer pages up to 2 MB are consumed with a streaming byte limit. Pages above the 250 KB cache-entry allowance are processed without being cached; all items and pagination metadata are preserved. Larger downloads are cancelled and remain unavailable rather than returning truncated history. The eight-entry cache, single-request concurrency and provider cooldowns are unchanged. No additional requests or database writes are introduced.

## Social evidence

An unreadable X shell now uses reciprocal links previously observed on the actual X profile, just as a complete X outage already did. Links expire after one hour. Metadata alone never establishes X ownership. First-time inaccessible X profiles still cannot be verified without an accessible authoritative source. No API, bypass or invented proof is added.

## Scanner

Oldest unchecked HOT/WARM tokens take precedence within their tier, retaining watched-token priority and warm coverage. `ACTIVE_TOKEN_MAX_PER_CYCLE=6` uses the existing sustainable hard cap. Tick stays one minute, concurrency three and cycle time budget 20 seconds. Quota deferral now reports CAPACITY_LIMITED instead of misleading HEALTHY. This is bounded monitoring of the existing shortlist, not coverage of every token.

## Volume breakout

Provider errors, rate-limit backoff, capacity limits, invalid snapshots, incomplete week and readable nonqualifying markets are separately logged. Seven completed UTC days, positive 24h movement and the 2x volume condition remain mandatory. Missing days are never filled as zero; no candles are written to the database.
