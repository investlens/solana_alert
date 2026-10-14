# Priority 1 — promotion coverage review (14 October 2026)

Status: review branch only. No production configuration, services, migrations or deployments changed.

## Read-only findings

The running revisions are main `53fb9ad` and ARC `5c3d5ae`. Three production workers are online, one running replica each, no crashes or pending deployments.

The rolling 24-hour ledger query on 14 October observed three Robinchain BOOST events and fourteen DEX_PAID events. All seventeen have confirmed delivery rows: nine per boost and eight per DEX payment, 139 acceptances total, zero unconfirmed rows in this cohort. Counts are recipient acceptances, not 139 events. The last DEX acceptance was 02:49 UTC / 08:19 IST. Different recipient counts require comparison against each feed's eligible cohort, not an assumption that all subscriptions are identical.

This confirms delivery of recorded events. It does not prove complete global discovery: latest/top lists and streams are bounded, provider omissions are possible, and ARC uses a direct delivery path rather than these semantic ledger rows. Running ARC scanners and stream activity were observed separately. A complete rejected/watched-event census is not currently persisted, so qualified-only event rows cannot measure all discovery decisions.

## Prepared changes

- Robinchain DEX priority processing returned success even when safety withheld delivery (zero accepted) or delivery partially failed. It also set a ten-minute cooldown on any nonzero acceptance. Now it reports completion and the long cooldown only when at least one recipient is confirmed and no recipient processing failed. Existing per-recipient claims protect accepted recipients during retry; ambiguous sends remain protected. All-muted and already-confirmed zero-send results can still use bounded retries; they are not represented as new deliveries.
- Quiet workers previously published health only on nonzero stage counters. Add fixed-source activity observations, including healthy empty batches, independent of screening and recipient counts. Existing once-per-minute publication is reused. Stream source names distinguish each endpoint; malformed/disconnected streams report unavailable. REST boost scans report activity or failure.
- No new poller, provider call, SQL write or raw-event store. Activity sources capped at 32. Retain existing safety, freshness, deduplication, recipient permissions and release delays.

## Remaining coverage limitations to resolve in subsequent batches

- Screening counters count checks. The fourth batch adds a distinct bounded event audit; this is a recent diagnostic window, not a complete historical census.
- The first review batch identified payment aging during evidence checks. The second batch now prepares a bounded fresh-observation watch; see the detailed safeguards below.
- The first review batch identified BOOST acknowledgement after any acceptance. The second batch now prepares recipient-protected recovery; concurrent/superseded attempts and recovery expiry require release review.
- Process restart loses volatile counters. A rolling historical report needs bounded aggregate retention rather than storing all tokens/provider payloads.
- Upstream bounded feeds cannot establish exhaustive worldwide promotion coverage.

## Release sequence

Run typecheck and the full regression suite, publish a draft review PR, review the identified retry behavior, then agree a deployment window with the user. Do not merge or deploy automatically: this phase is explicitly isolated from current alerts.

## Second review batch — recipient recovery and fresh-payment watch

Prepared in the same unmerged main draft:

- New boost attempts checkpoint recipient protection before sending. A partial attempt retains its pending event rather than acknowledging global completion. A short owner-scoped recovery lease coordinates retries; stable per-recipient claims skip accepted recipients and hold ambiguous sends. Historical/global boost claims are not deleted. Legacy pending attempts lacking the protection checkpoint do not gain permission to bypass historical claims.
- Failed reservation/recipient setup and unconfirmed claims prevent global acknowledgement. Complete fan-out can include previously confirmed recipients without resending them. The initial admin fallback also uses the recipient guard and remains pending for the other eligible users. Recovery does not invoke an admin fallback when shared delivery is unavailable.
- Pending recovery expires after the existing thirty-minute bound, reports expiry without claiming Telegram delivery, and absorbs the expired observed total so it cannot resurrect as a new purchase. A newer boost total retains its own event identity. The third batch replaces the single pending token slot with bounded purchase identities; see below.
- Robinchain DEX payments actually observed while fresh are retained for at most thirty minutes from payment time. The checkpoint holds at most twenty-four token/payment/observation triples. Late first-seen payments, mismatched payments, future observations and expired checkpoints cannot grant eligibility. Restored watches seed the existing bounded queues; no new poller. Every attempt still requires current confirmed paid-order evidence and the existing custom selling/security gate or verified PONS exemption.
- Added Redis recipient claims/checkpoint writes are bounded. Existing provider-request budgets, safety decisions, mute preferences and release delays are preserved. Unknown Telegram acceptance remains unconfirmed, never a fabricated success.

Remaining before release: independent review of concurrent/superseded boost handling and first-seen payment checkpoints, plus unique-event reconciliation diagnostics. Production remains untouched.

Second-batch local validation: TypeScript typecheck and all 918 tests passed, including ten recovery regressions. Completed DEX watches are removed; their last confirmed receipt is distinguished from a new Telegram acceptance. Draft only, not deployed.

Boost-specific recipient claims retain the same owner across retries while capping each retry pause at one second, avoiding a new thirty-second pause in the boost fan-out path. DEX claim timings are unchanged.

Recovery classification is pinned to the pending attempt’s original prior total and increment. A newer purchase can use the already-observed pending total as evidence even before delivery finishes, so an in-flight attempt does not cause the next genuine increase to be silently absorbed as historical state.

The final DEX gate also matches the currently confirmed paid order to the event’s expected payment timestamp, preventing a changed provider order from authorizing the wrong pending event.


## Third review batch — overlapping purchase identities

- BOOST pending state and retry cooldowns use token plus observed cumulative total, retaining up to 100 purchase identities. Each retains its original increment, prior total, observation time and recipient protection checkpoint. Older and newer purchases can complete independently; completion never lowers the observed token total. Restored attempts no longer roll back the live-only startup baseline. Pending events are scheduled even when the same token has a newer row in the feed. Capacity overflow and expiry explicitly log unconfirmed outcomes, never delivery success.
- Fresh DEX watches retain up to 24 distinct token/payment identities instead of 24 token slots. Seconds/milliseconds normalize to the same identity. Restarts restore multiple payments for one token, and completing one payment removes only that watch.
- The existing orders response exposes all eligible payment timestamps without another provider request. Each invocation captures due fresh payments and processes at most one due purchase, preserving the existing scanner request budget. Per-purchase cooldowns prevent a newer order from overwriting an older retry. The final gate verifies the exact expected timestamp is still in the current eligible paid-order set; an unrelated newer payment cannot authorize a withdrawn older order.
- No new chain, poller, worker, migration or delivery timing change. The identities reflect observed cumulative boost totals and provider payment timestamps; simultaneous orders with identical timestamps cannot be distinguished without upstream order IDs. Unseen intermediate boost purchases cannot be reconstructed from aggregates.

The fourth batch adds bounded unique-event reporting. These fixes do not constitute an exhaustive discovery census. Production remains unchanged; release readiness requires final CI on both review branches.

Third-batch local validation: typecheck and all 921 tests passed, including separate close-payment restore/completion, withdrawn older-order rejection, and newer-before-older boost completion. No production mutation or test Telegram messages.


## Fourth review batch — event audit and release review

- Existing per-worker health snapshots now include up to 128 opaque purchase identities for a one-hour diagnostic window. Repeated checks do not increase the unique-event count; a confirmed delivery cannot be downgraded by rediscovery. Current stages distinguish observed, ready, watched, blocked, delivery pending, delivered and expired. Capacity evictions and aged-out entries are explicit. No recipient identifiers, token payloads, SQL writes or new polling loops. The existing at-most-once-per-minute publication carries this audit.
- Critical recovery checkpoint reads distinguish a genuinely missing key from unavailable Redis. Failed reads prevent destructive empty-state startup; retries can recover on a subsequent cycle. Critical writes require acknowledgement before sending a new protected boost or processing a captured DEX payment. Failed unsent boost protection writes revert the protection flag and release only the owned unsent claim. DEX checkpoint updates coalesce, preventing earlier best-effort snapshots from overwriting newer observations.
- Independent release review found equivalent ARC overwrite and stale-payment authorization risks. Companion PR #222 now prepares per-purchase boost recovery and exact currently eligible DEX timestamps, with the same existing scan budgets. ARC records the audit through its direct path. Prior-confirmed recipient claims are distinguished from new acceptances; an empty recipient cohort cannot acknowledge a boost as delivered.

Validation: main typecheck and all 924 tests passed; ARC typecheck and all 598 tests passed. Includes close purchases, out-of-order completion, aging, restore, cancelled/removed/malformed orders, partial/ambiguous recipient sends, checkpoint read/write failure, audit deduplication and explicit capacity limits. Existing timing/security/wallet/winner regressions also pass. A final targeted ARC run passed after bounding the delivered-identity cache.

## Controlled release checklist

1. Final GitHub CI must pass for PR #221 (main) and PR #222 (arc-integration). Keep both unmerged until the requested deployment action.
2. Confirm source revisions and preserve rollback points: main/PONS production 53fb9ad; ARC production 5c3d5ae. Runtime checks on 14 October found all three online, one running replica each, zero crashes and no pending deployments.
3. Release only the relevant source branch/services. Do not enable Solana, AI watchdog, auto trading or X automation. No database migration, secret request or new service is required.
4. Following deployment, verify terminal SUCCESS, replica health, nonzero-or-empty feed activity, checkpoint readiness, and actual confirmed deliveries with recipient timing. CI does not substitute for observing the new runtime.
5. If runtime regression occurs, use the recorded prior revisions. Preserve recovery checkpoints and recipient claims for review; do not delete claims or force replay ambiguous Telegram sends. The previous runtime does not understand multiple overlapping pending events, so a rollback needs follow-up reconciliation of unfinished deliveries.

Release scope: ready for controlled deployment when final CI is green. This certifies the coverage/recovery package, not worldwide upstream completeness, read receipts, all future trades, or a premium launch across new chains. The diagnostic event window resets with the worker; published snapshots expire after one hour. Unknown or absent snapshots remain unknown rather than zero activity.
