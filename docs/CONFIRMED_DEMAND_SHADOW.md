# Confirmed Demand: evidence audit and offline shadow prototype

Status: offline prototype. No live collection, Telegram sends, deployment,
database changes, provider calls or production imports. Existing alert eligibility,
delivery timing and security gates are unchanged. No claim of improved outcomes.

## What the current code can establish

| Information | Existing source | Accuracy boundary |
| --- | --- | --- |
| Price, LP, aggregate buys/sells | ChainMarketSnapshot | Transactions are not distinct buyers; quotes are not executable exits. |
| Exact creator holding | positionCheckService | Block-pinned pre-bond PONS evidence; not all side wallets or DEX exit depth. |
| Creator transfers/burn destinations | creatorActivityEvidence | Bounded 512-block range; transfers are not proven sales or common ownership. |
| Creator sales | PONS reported recent trade page | Partial page reporting; absence does not establish no selling. |
| Reported wallet trades and quote amounts | PONS page trade items | Fields exist in the parser, but live coverage and swap receipts have not been verified for this prototype. |
| Holder concentration | Holder risk scanner | Sampled holders do not establish independent demand or retention. |
| Independent buyers / linked wallets / retention | No complete existing source | Unknown. Do not substitute transaction counts or repeat buys. |
| Current executable exit / retest / LP lock | Separate evidence required | Not established by these trade windows. |

This audit concerns available repository data paths, not a fresh production health
check or a successful live provider validation. ARC trade-page coverage is not
established. No Solana work is included.

## Prototype

`readReportedDemandWindow` accepts at most 100 rows from an already identity-bound
PONS page. It validates wallet, tx/log identity, positive quote amounts and time;
rejects duplicates, future rows, unordered pages and incomplete five-minute windows.
The caller still needs exact token/creator/venue provenance; supplying a scope is
not a verification of it. There is deliberately no live adapter yet.

`compareReportedDemand` compares consecutive non-overlapping windows from the same
token, creator and venue, with at most a one-minute gap. It reports non-creator
wallet counts, repeat buy wallets, quote amounts and reported creator sales.
Quote amounts remain in the page's quote asset. They are not converted to USD.
Repeat buying is not balance retention; different wallets may share ownership.

The result is always `INSUFFICIENT_EVIDENCE`, with `eligibleForAlert: false`.
This is an evidence readiness tool, not a signal generator or outcome study.

Replay an explicitly supplied local JSON file (maximum 256 KiB):

```
node --import tsx scripts/replayConfirmedDemand.ts input.json
```

Input shape: `{ first: { scope, page }, second: { scope, page } }`.
Scope: `{token,creator,venue,observedAt}` (milliseconds).
Page: `{items,nextCursor}`; each row has `id` (`txHash:logIndex`), `txHash`,
`trader`, `side`, `timestamp` (seconds), `quoteAmount`. Output contains aggregates,
missing evidence and limitations; no wallet list. No raw capture is retained.

## Next acceptance gates

1. Validate representative live PONS and ARC schemas and exact venue provenance,
   including field availability, pagination limits and source freshness. Do not
   promise a positive signal before coverage is known.
2. Add bounded, chain-verified swap and balance evidence using existing provider
   budgets. Define related-wallet coverage explicitly; missing evidence stays unknown.
3. Establish size-specific exit estimates, creator distribution coverage, LP status
   and comparable price/retest observations. Unlocked LP must warn, never mean safe.
4. Only then integrate passive shadow observations into existing scheduled work,
   behind an off-by-default switch, with a shared cap and failure cooldown.
5. Compare timestamped same-venue/same-unit outcomes against existing feeds, report
   missing coverage and sample selection, and choose thresholds from evidence.
   No public feed until validation supports it. No invented success rate.
