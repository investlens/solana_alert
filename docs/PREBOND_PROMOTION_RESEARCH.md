# Separate pre-bond promotion research

Status (20 October 2026): **deployed with research collection disabled**.
PR #243 merged as `6c04b2e703102dc943186515e2d830c882d09ad5`. The isolated
migration is applied; worker/public-role access checks passed. Live activation
awaits explicit approval after automatic approval review blocked the flag change.
No research baseline or checkpoint has been collected. Current alert filters,
delivery timings and winner/developer records are unchanged.

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
  operation deadlines (including queued time and response consumption). SDK
  automatic retries are disabled per research request; the shared alert client
  and its retry behavior are unchanged. Failures pause optional work for sixty seconds. No ambiguous
  Telegram send is repeated; this module has no Telegram dependency.

## Verification and release gate

Typecheck and all 1,047 repository tests passed (20 October retest; zero failures
or skipped tests, with test concurrency limited to two). New tests execute the migration
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

Worker-side read-only validation on 20 October 2026 at 05:45 UTC passed
chain identity and measured two native-quote snapshots in 240 ms and 236 ms
(six calls each, individual calls 33–45 ms). Both used pinned block 93219369,
hash `0x3047cd653ddf97c64829a9bce9821745dd7729fccc1f0a2b5e845ce8d4f1c619`,
with fresh chain timestamps and validated token/curve identities. A third candidate
returned `UNAVAILABLE / NON_NATIVE_QUOTE` in 143 ms, as designed. No provider
replacement or relaxed deadline is justified by this sample. These reserve ratios
are not USD prices or executable investment returns.

The first worker probe's optional latest-launch database lookup timed out before
RPC. Supplying three public identities from the verified launch index isolated
RPC performance; it did not validate the collector's complete database path.
The diagnostic made no research writes, sent no alerts, and kept collection off.

The migration, live role checks and disabled deployment gates are complete.
Research remains disabled pending explicit activation approval. Live reader and
exact database lookup checks passed for small samples; sustained collector
availability remains unproven until actual admission and checkpoints are observed.
Next:

1. Obtain explicit approval to enable research collection on the main bot and PONS worker.
2. Enable the scoped research flag under the stated budgets and verify existing health.
3. Verify one actual admission and checkpoints over their real observation windows.
   Never backfill old alerts or claim a completed six-hour study at startup.

ARC, custom tokens and Solana are outside this research cohort. The separate
Confirmed Demand draft and developer card PR are not included.

## Database-path repair (20 October 2026)

The failed original diagnostic used an unindexed latest-launch ordering. Its
PostgreSQL plan scans and sorts an estimated 47,466 matching rows. This is not
the collector query: the exact-token lookup uses `pons_launches_token_factory_idx`
and completed in 0.163 ms server execution time in a read-only production check.
The revised protocol-filtered, two-row-limit query also used that index and took
1.394 ms in a subsequent read-only check.
SQL timing excludes the worker HTTP path and does not establish the cause of the
original transport timeout. No new index or broad scan was added.

The isolated store now awaits lazy builders inside background/deadline scopes,
checks cancellation before starting and after resolving a request, and explicitly
disables SDK automatic retries on each research operation. The lookup filters
one token/chain/protocol, reads at most two records, and rejects ambiguous or
unverified provenance rather than choosing an arbitrary first row. Coordinator
failure logs identify the phase and elapsed time; raw errors and credentials
are not emitted. Existing alert/client transport files remain untouched.

A manual read-only check uses the same store lookup (one to three public token
addresses; no migration, writes, RPC samples, or Telegram sends):

```sh
node --import tsx scripts/probePrebondWorker.ts <token-address>
```

The store tests exercise the installed Supabase SDK with a controlled transport,
including exact filtering/row bounds, verified/ambiguous identities, transient
errors without retries, transport cancellation, late responses, already-expired
parents, and isolated registration/claim/finish endpoints. These transport tests
complement the PostgreSQL ledger and pinned-block reader tests.

At 06:01 UTC on 20 October, the exact same store lookup ran read-only on the
existing Railway PONS worker against three public token identities. All returned
`VERIFIED` in 738 ms, 675 ms and 669 ms, within the unchanged two-second budget.
The third identity was the non-native quote rejected by the separate RPC probe:
a verified launch identity does not mean a supported quote or research admission.
No research rows were written, no research flag enabled, and no Telegram messages
were sent by the probe. Normal `main` source was reconnected after capture.

This clears the exact lookup transport gate, not the live registration/claim/finish
gate. The functions were subsequently created by the migration and their live role
access was verified below. Successful live admission and checkpoints still must
follow activation and their real observation windows. No research data is represented as a
completed outcome before its real observation windows.

## Disabled production rollout (20 October 2026)

Migration `20261020072452` (`prebond_promotion_research`) applied successfully.
The repository migration filename matches the actual Supabase-generated history
version; its SQL is unchanged from the tested draft.

Rollback-only calls under the actual `service_role` returned
`NO_ACCEPTED_BASELINE`, an empty claim and `STALE` for an unowned finish. No
research data was inserted. Both `anon` and `authenticated` were verified to lack
SELECT/INSERT and EXECUTE grants on all three functions; actual SELECT and claim
calls were denied under both roles. RLS is enabled. The post-migration security
advisor adds only the expected INFO `rls_enabled_no_policy` notice for the private
worker table (public grants are revoked); no new warning/error finding appeared.

Disabled deployments both reached SUCCESS on commit `6c04b2e`:

* Main bot: `d8bfcfcb-6afe-4781-af18-d75b1227c6d6`; promotion streams, Boost,
  DEX paid and wallet workers resumed. One transient Telegram 409 occurred during
  old/new instance handover, followed by the polling supervisor restart.
* PONS worker: `942a2430-19d2-444c-bee8-4b3aef6aa3c5`; normal five-second
  watcher resumed, detected/handled three launches after deployment.
* ARC deployment was unchanged. No new service or timer was created.

Automatic approval review rejected enabling the research flag on both services:
it interpreted the user's approval as covering migration/checks, not persistent
activation. No bypass was attempted. The flag remains absent/off, and the table
is empty. Activation needs explicit approval; no old alerts may be backfilled or
artificially relabelled to create a research baseline.

Rollback: keep/set `PREBOND_PROMOTION_RESEARCH_ENABLED=false` on both services.
The isolated empty table can remain; no shared alert data or outcome schema needs
rollback. If runtime code rollback is necessary, the previous live commit was
`84f8541649e8f035414a4d481299eff3b9fb8afa`.
