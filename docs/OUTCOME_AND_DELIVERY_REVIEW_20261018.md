# Outcome coverage and release clock review — 18 October 2026

Production read at 15:11–15:14 UTC. Scope: deployed promotion baseline ledger,
compact tracking and bounded runtime timing logs. No inference of profit or
all-recipient delivery from an event count alone.

## Coverage

All 31 Robinhood Boost/DEX alert events since 17 October 13:25 UTC had matching
baseline ledger records; none missing. There were 31 retained ledger records:

| Feed / evidence | Admission | Events |
| --- | --- | ---: |
| DEX paid / exact DEX pair | REGISTERED | 5 |
| Boost / exact DEX pair | REGISTERED | 1 |
| Boost / exact DEX pair | REUSED | 2 |
| DEX paid / pre-bond, no comparable DEX baseline | NO_BASELINE | 22 |
| Boost / unverified market source | NO_BASELINE | 1 |

This confirms **recording coverage**, not full outcome coverage. Eight events had
comparable DEX quotes, six started fresh trackers, two reused token trackers.
The six fresh trackers finalized as three FAILED and three NEUTRAL. Reused rows
joined to one WINNER and one INCOMPLETE tracker; those outcomes must not be
attributed to the newer promotion without checking baseline/checkpoint times.
There were seven active compact trackers overall and zero more than ten minutes
overdue at the check. Pre-bond quotes must remain a separate unit/venue cohort.
Do not add retrospective DEX baselines to make these records look complete.

## Recent timing sample

Main service runtime logs from 09:00 UTC to retrieval contained 54 structured
acceptance records across six DEX-paid events (additional unstructured counter
lines excluded). All recorded release deadlines were respected:

| Lane | Records | Min / median / max acceptance elapsed |
| --- | ---: | --- |
| Undelayed | 6 | 2,500 / 2,649 / 3,231 ms |
| Pro | 6 | 5,888 / 5,927 / 5,937 ms |
| Free | 42 | 31,158 / 31,475 / 32,924 ms |

These measure Telegram acceptance after the local delivery anchor, not detection
latency or device receipt. No retry/restart continuity can be established from
this sample alone; earlier logs and the current code showed a fresh clock per
invocation. Security, preparation, rate limits and claim retries can still delay
acceptance. Tier releases are earliest-send times, not exact arrival guarantees.

## Implemented fix

`eventDeliveryClock` retains one Redis timestamp per hashed chain/event identity
for 24 hours, reused across retries and worker restarts. Begin the lookup at the
existing delivery anchor and overlap it with recipient/card preparation. Await it
before fanout. No timestamps are taken from untrusted payment or token metadata.
Different event identities (including Boost increments) retain distinct clocks.

At most 512 local entries and 16 in-flight lookups, a 150ms caller deadline and a
60s failure cooldown. One Redis operation per uncached event, no per-user reads,
new workers, timers for polling, DB rows or provider calls. The one-shot deadline
timer is cleared on completion. Redis keys expire; retries do not refresh TTL.

During Redis failure, retain the earliest local anchor, allowing the existing
delivery path to continue through **unchanged** security and recipient claims.
Cross-restart continuity cannot be guaranteed during that outage and is logged
explicitly. A timed-out operation may still write the same original timestamp.
No ambiguous send is replayed and no claim is bypassed by this clock.

Only the semantic alert delivery path is changed. Other specialized feed senders
remain as before. Existing admin/Pro/free release policy is unchanged. The fix
prevents repeated tier waiting on retries; it does not solve provider backoff or
security-check latency. No production clock keys are backfilled or fabricated.

## Remaining priorities

* Add separate, bounded pre-bond outcome observations and explicitly mark venue
  transitions; keep USD DEX results separate from curve-ratio results.
* Assess new setup rules in the separate offline/shadow draft, with actual
  recipients and holdings; do not tighten Boost/DEX or relabel paid events.
* Developer card clarity is independently prepared in PR241; its name enrichment
  is still outstanding. Confirmed Demand PR240 remains an isolated draft.
* This patch requires CI and a controlled rollout before claiming live repair.
