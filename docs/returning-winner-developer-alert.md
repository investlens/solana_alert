# Returning Winner Developer — PONS

An independent discovery feed, `RH_RETURNING_WINNER_DEV`, for a fresh verified
PONS factory launch from a wallet with a previously measured compact winner.
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
- Show complete assessed **sessions**, failures, neutral results and incomplete
  results separately. These counts are a tracked sample, not all launches or a
  promise about performance. One prior winner qualifies; small samples are labelled.
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
