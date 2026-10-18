# Separate pre-bond promotion research

Status: implemented and locally tested, **disabled by default and not released**.
`PREBOND_PROMOTION_RESEARCH_ENABLED` must be explicitly enabled after validation.
The migration has not been applied to production. No current alert filters,
delivery timings or winner/developer records are changed by this draft.

## What it measures

For a confirmed Boost/DEX promotion whose rendered baseline was pre-bond, attempt
one later first observation of the indexed, verified V2 PONS curve. Read native
quote identity, token identity, graduation state and reserves at the same block,
two blocks behind head; require a fresh matching block header/hash. This is
`ETH_RESERVE_RATIO`, not USD, a trade quote, realized return or a liquidity value.
Virtual reserves, taxes, fees and price impact make reserve ratios unsuitable as
executable proceeds.

The baseline is explicitly `FIRST_POST_ACCEPTANCE_OBSERVATION`: the original
Telegram card price is not reconstructed. Admission requires a matching durable
promotion baseline/first acceptance, exact indexed token/curve identity, a
positive native ratio and an observation within two minutes after acceptance.
Application checks also require an enabled V2 factory/version from the registry.
SQL records this baseline only in `alpha_prebond_research`.

Checkpoints are 15 minutes, one hour and six hours after that first observation.
Missing/late/failed price observations remain unavailable. A current quote outside the
five-minute checkpoint grace cannot replace a missed historical price. Graduation
ends the cohort as `VENUE_TRANSITION`, including when first observed after a missed
checkpoint (using its actual observation time); it never joins a DEX quote onto the curve
series. Three measured observations produce a sampled change only, not a WINNER
classification. There are no writes to shared successful-token, creator outcome
or runner notification tables. No user-facing alert is sent by this feature.

## Resource and failure bounds

* Worker-only table, RLS enabled; all public/anon/authenticated grants revoked.
  Functions use invoker security and an empty search path.
* Ten active cohorts, 200 total retained rows, seven-day cleanup on ongoing work
  deleting at most ten expired rows per call. Three small samples per cohort.
* One shared admission attempt per minute, one in-flight observation per process,
  and a database admission fence. A token with an active cohort is reused; this
  is a bounded cohort sample, not one independent outcome per paid event.
* One research checkpoint per minute globally, using only a spare slot after the
  existing compact worker's two-checkpoint allowance. Existing compact work has
  priority. Under continuous load research can miss its window and become
  incomplete; no extra timer or server is introduced to conceal that gap.
* Each curve observation uses at most six sequential RPC operations (head,
  header and four contract reads), under a four-second deadline in production.
  Graduation requires five. Existing provider failover can try alternate
  transports within that deadline; no historical scans are added.
* Baseline collection occurs after confirmed delivery and successful baseline
  persistence, fire-and-forget. It is never awaited by initial alert fanout.
* Database calls use the existing background transport lane and two-second
  deadlines. Failures pause optional work for sixty seconds. No ambiguous
  Telegram send is repeated; this module has no Telegram dependency.

## Verification and release gate

Typecheck and all 1,041 repository tests passed. New tests execute the migration
in PostgreSQL/PGlite and check acceptance/provenance validation, rate/active/total
caps, retention batches, lease handling, missed windows, venue transition,
complete sampled change and access restrictions. Reader tests check fixed-block
reads, native quote identity, stale/future headers, zero reserves, mismatched
tokens, cancellation and provider failures. Shared winner tables are absent from
the database fixture, so unintended writes to them fail the tests.

Live read-only validation on 18 October 2026, approximately 15:33–15:34 UTC, used
an indexed V2 launch:
`0x3a331b6eb398495ff0d4bd3bc4b552ba114a68d8`, curve
`0x17ef5fb29729ab4ceb3ad257a383b84c3f590591`.
The official RPC attempt reached the header read and timed out; the existing
PublicNode fallback timed out on its first request. Both correctly returned
`UNAVAILABLE / PROVIDER_UNAVAILABLE`, with no fabricated ratio. These requests
were made from the development environment via its network path, not Railway;
they do not establish a production RPC outage. They also do not prove the live
reader can complete within its production deadline.

Keep this draft unmerged and the feature disabled until a fresh live snapshot
passes identity, timestamp and pinned-block checks within the deadline. Then:

1. Recheck CI and migration/security advice; apply the isolated migration first.
2. Verify worker-role calls and anonymous denial with rollback-only checks.
3. Release disabled, verify existing polling/scanning/delivery health, then enable
   the scoped research flag under the stated budgets.
4. Verify one actual admission and checkpoints over their real observation windows.
   Never backfill old alerts or claim a completed six-hour study at startup.

ARC, custom tokens and Solana are outside this research cohort. The separate
Confirmed Demand draft and developer card PR are not included.
