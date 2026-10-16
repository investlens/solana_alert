# Developer DEX Track Record — PONS

The existing `RH_RETURNING_WINNER_DEV` preference/delivery key is preserved, but
success now means reaching the official DEX pool, not an alert-price return.

## User rule

At least **30% of all distinct indexed prior PONS projects** must have independently
established official DEX-reach evidence. Three of ten qualifies; six of 200 does
not; sixty of 200 qualifies. No 60% threshold, minimum three price winners, 50-launch
cap or five-launch-per-day cap remains in this feed's qualification rule. Existing
reviewed harmful-history and router security/registry blocks remain separate.

The current/new launch is excluded. For final qualification, both the previous
launch and its DEX evidence must precede the new launch. Later observations cannot
create retrospective qualification. Unknown DEX status remains in the denominator
and contributes nothing to the numerator. Small histories are labelled; DEX reach
is not profit, quality, liquidity protection or investment safety.

## Evidence and limitations

`alpha_pons_dex_reached` retains one compact row per exact token: creator/factory
from the authoritative launch census, official mapped pool, evidence type and
observation time. V2 needs existing curve-token/graduated=true verification plus
an exact-token official pool mapping and a usable matching DEX pair; V1 uses its
verified direct-to-pool launch provenance and official mapping. A secondary pair,
DEX-paid order, market-cap milestone or positive price return is insufficient.

Capture observes the existing validated venue result in alert stats enrichment.
There are no extra market/RPC requests, no scanner and no image work. Capture is
asynchronous, background-governed, max ten observations per batch/minute per
process, queue cap fifty, five-minute pending expiry and bounded daily suppression.
The existing PONS minute callback also drains its local pending observations.
Public database roles cannot read or submit evidence. This backend evidence ledger
is an internal trust boundary, not a public attestation protocol.

Historical price results are preserved for their original purpose, never relabelled
as DEX-graduation evidence. Existing records do not constitute a complete historical
graduation census. Unverified historical projects cannot silently become successes.
The card explicitly describes indexed coverage, which may be incomplete.

## Eligibility and delivery

A five-minute background snapshot shortlists at most 1,000 developer wallets that
have DEX evidence. Counts use the existing chain/deployer/time index and the complete
indexed history for those candidates, not a newest-fifty sample. Shared shortlisting
allows one prospective launch difference; **one fresh exact-token/developer check
is mandatory before any delivery**, with exact prior-launch counts and the 30% rule.
A shortlist can never directly render a card. At most three DEX references are kept,
including the earliest and two latest to avoid hiding all older evidence.

The continuous PONS listener, pending cap 100, two delivery jobs, recipient-level
seven-day deduplication, persisted mutes and existing private timing are retained.
No replay/backfill Telegram sends, trading, new service or interval. Boost/DEX
eligibility, delivery claims, existing alert text and timing are unchanged. The only
shared stats integration adds asynchronous evidence capture after a validated venue
result is published; it never waits for persistence or changes returned stats.

## Validation

Tests include 3/10 pass, 6/200 fail, 60/200 pass, unknown status, current-launch
exclusion, duplicate events, future proof, private access, queue limits and exact
venue proof. Sparse price-win history alone cannot qualify. Legacy policy snapshots
fail closed. The rollout pauses this feed until the new worker and database policy
are verified, then restores its enabled setting.
