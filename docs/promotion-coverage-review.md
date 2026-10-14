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

- Current health screening counters count checks, not unique promotion events; exact event-stage reconciliation still needs a bounded identity-aware audit.
- A payment first observed while fresh can age out of Robinchain's ten-minute safety window while sell evidence is pending. ARC already has a separate thirty-minute fresh-observation watch. Any Robinchain alignment must preserve first-observed freshness and must not replay older first-seen payments.
- Robinchain BOOST acknowledges global completion after any acceptance; review per-recipient partial-failure recovery before modifying this critical lease path.
- Process restart loses volatile counters. A rolling historical report needs bounded aggregate retention rather than storing all tokens/provider payloads.
- Upstream bounded feeds cannot establish exhaustive worldwide promotion coverage.

## Release sequence

Run typecheck and the full regression suite, publish a draft review PR, review the identified retry behavior, then agree a deployment window with the user. Do not merge or deploy automatically: this phase is explicitly isolated from current alerts.
