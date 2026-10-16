# Token classification and retention

The backend-only `alpha_token_classification` view derives categories from the
existing compact outcomes. It stores no duplicate token history and triggers no
market requests or new alert writes.

| Category | Meaning |
| --- | --- |
| TRACKING | Assessment has not finished |
| WINNER | Existing measured winner criteria passed |
| FAILED | Existing measured failure criteria passed; this is not a scam finding |
| OTHER_OBSERVED | Completed neutral performance; not labelled worthless |
| UNVERIFIED_INCOMPLETE | Missing checkpoint evidence or no performance record |
| CONFIRMED_HARMFUL | Explicitly reviewed on-chain restriction/exploit evidence |

Risk and performance remain separate fields: a harmful token can still have a
measured winning return. No category changes delivery eligibility in this release.

## Reviewed harmful evidence

`alpha_reviewed_token_risk` holds only a token/chain, status, bounded reason and
note, transaction hash, review reference/time and developer identity if verified
independently through the PONS census or direct deployment proof. It stores no raw
receipts. `alpha_set_reviewed_token_risk` is backend-only and requires an explicit
review reference. Use a transaction reference only after its evidence establishes
the stated restriction/exploit; a hash alone does not prove misconduct.

There is deliberately no automatic promotion of third-party honeypot flags,
unlocked LP, zero observed sells, repeated launches or price declines into this
ledger. Existing security alerts/checks continue unchanged. A reviewer must assess
the actual evidence before writing a confirmed record. Incorrect findings can be
marked RETRACTED without deleting their review reference. This release adds the
private reviewed-record interface, not a Telegram review command or user-facing
Pro display.

## Existing maintenance cycle

- Expire failed/incomplete detail after 48 hours when its developer is already
  verified and the existing finalizer/linker has accounted for its outcome.
- Reviewed harmful detail also expires after 48 hours, preserving its compact risk
  record and any matching winner archive.
- Unknown-developer and neutral cases retain seven days after finalization, so
  checkpoint review and late identity linkage remain possible. Winner assessment
  detail also retains seven days before relying on its durable archive.
- Remove at most 25 expired tracking rows per existing five-minute maintenance
  call. Active/recent rows cannot be deleted.
- Winner detail is removable only when its matching baseline/unit/samples already
  exist in the durable winner archive. The archive itself is never deleted here.
- Delay deletion when a missing developer identity is already recoverable from
  verified proof; reconciliation must count it first.
- Delete at most 25 orphan deployment-evidence rows older than seven days per call.
  Evidence used by a winner or reviewed-risk record is retained.
- Keep developer summary counts, daily feed totals and compact reviewed harmful
  records. Losing-token detail eventually disappears; aggregate outcomes remain.
- Fill missing reviewed-risk developer identity from later verified proof in
  batches of at most 25, preserving the original review evidence and timestamp.
- No census, delivery ledger, deduplication key, subscription, opportunity, or
  unrelated historical/AI table is part of this cleanup.

Normal database vacuum can reuse freed space. Row cleanup does not promise an
immediate reduction in the database's allocated disk size.
