# Returning Winner Developer — PONS

An independent discovery feed, `RH_RETURNING_WINNER_DEV`, for a fresh verified
PONS factory launch from a wallet meeting the version-two measured developer quality policy.
This does not replace the older market-cap-peak-based developer alert, Boost,
DEX Paid, or ordinary launch filtering.

## Evidence and presentation

- The existing live listener supplies the exact approved factory, token, deployer,
  transaction, log index, block and timestamp. Reject invalid factory/version/block
  mappings, launches older than ten minutes and future timestamps over 30 seconds.
- Match the exact Robinhood-chain deployer to an internally consistent creator
  summary and a retained winner with verified PONS/creation-receipt provenance.
- Independently validate all three measured, ordered sample prices and recorded
  ROI arithmetic. The prior assessment must precede the new launch; the token
  itself cannot count as its own prior winner.
- Exclude reviewed harmful developers/prior tokens from this new feed and honor
  existing blocked/risk developer registry decisions. Other alerts are unchanged.
- Show distinct winning-token / indexed-launch counts prominently, and complete assessed **sessions**, failures, neutral results and incomplete
  results separately. These counts are a tracked sample, not all launches or a
  promise about performance. Session wins alone never qualify. Version two requires at least three distinct verified PONS winning tokens, at least 60% demonstrated winning-token coverage of indexed PONS launches, fewer than 50 indexed launch events, and no more than five launches in 24 hours. Unknown census coverage fails closed. These are conservative discovery thresholds, not a promise of returns.
- Label USD-price and native curve-reserve-ratio returns separately. Link the new
  token directly to PONS, avoiding an empty pre-bond DEX page. Names are reused only
  from existing exact-token cached PONS context; otherwise show name pending.
- LP status remains explicitly unverified. Do not turn launch provenance or a
  previous winner into a safety claim. There is no automatic trading.

## Delivery and load

The continuous PONS process alone injects the new queue hook. Replay/once modes
never inject it. Normal launch work does not await history reads or Telegram sends.
No historical Telegram backfill is performed.

One background-governed history snapshot per five minutes is shared across all
launches, capped at 1,000 developers and three winner references per developer.
Keep the earliest winner and two most recent references so a recent assessment
cannot hide all earlier qualifying history. Failed/denied snapshot reads retry no
more than once per minute. A full snapshot reports its capped coverage.

Hold at most 100 fresh launch references in RAM, two delivery jobs in flight, and
one deferred retry of a job if the recipient/claim store is unavailable. Pending
launches expire after ten minutes. The existing compact-outcome minute timer also
drains this queue; no new timer, worker, market scan, image render or price poll.

Reuse subscriber loading, explicit feed preferences, tier release scheduling and
bounded recipient lanes. Recipient-level seven-day Redis claims use an independent
`alphaos:returning-winner:` prefix. Redis ambiguity fails closed, and ambiguous
Telegram responses retain their claim rather than blindly repeating messages.
Aggregate feed-health/timing logs contain no recipient IDs. Existing mute caches
remain compatible when this new feed is added, avoiding a subscriber-query burst.
The new feed reads its sparse mute preferences in one bounded database batch per
qualifying event. This prevents older workers' legacy cache format from overriding
a persisted new-feed mute. Its settings menu and toggle read the same source.

This launch-discovery card adds no price baseline or extra outcome sampling. Any
later qualifying normal/Boost/DEX alert continues its existing tracking independently.

## Quality fix — 16 October 2026

A developer with one recorded winner and hundreds of launches was incorrectly eligible under version one. The feed was paused during the repair; Boost/DEX rules and timing were not changed. Version two rejects legacy snapshots and one-hit/sparse/high-frequency cases. Count unique token addresses rather than repeated outcome sessions. Recalculate retained winner arithmetic in both SQL and TypeScript. Winning PONS tokens must match an approved factory/version/block census record. Preserve harmful-history exclusions and private backend-only access.

Census reads use the existing chain/deployer/time index and inspect at most 51 rows per candidate (at most 1,000 summary candidates) on the existing five-minute refresh. Fifty or more rows fail conservatively; no unbounded lifetime count is performed in the worker. Each cached positive receives one fresh exact-wallet/token qualification read before recipient lookup or delivery. This catches additional launches that changed launch cadence or denominator during the shared-cache interval. No per-user qualification requests, new service, market scans or price polling.

At least three distinct references must pass and precede the new launch; the new token cannot count itself. The card distinguishes measured winner-token coverage from session outcomes and partial census coverage. Incomplete/unmeasured launches are never declared scams or silently counted as winning. No developer currently meets the new three-winner threshold; absence of this feed alone is expected until verified evidence qualifies.
