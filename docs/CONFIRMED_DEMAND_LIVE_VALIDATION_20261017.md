# Live source validation — 17 October 2026 UTC

Read-only bounded sample, approximately 18:23–18:31 UTC. No production changes,
scheduled collector, alert sends, secret access or new service. This is source
validation, not a system-wide health check or a statistically useful outcome study.

## PONS

Selected recent Boost, DEX-paid and trade-setup contracts from the existing alert
audit; looked up exact indexed launch identities for PONS samples. Read three
PONS launch pages plus one latest indexed pre-bond launch page. The custom
DEX-paid contract was not in the indexed launch table and did not return a usable
launch/trade record; do not generalize PONS coverage to custom tokens.

| Sample | Token | Stage | Page rows | Five-minute parser result |
| --- | --- | --- | --- | --- |
| Recent Boost | `0xa01ff10774cfe53c3fbc1d7d124c42e19f6afcbd` | Graduated | 50 | Accepted reported window; 2 buys, 0 sells |
| Recent setup | `0xde97752448fd7d958caa7749dae91a6fe14a3133` | Graduated | 50 | Accepted reported window; 1 buy, 2 sells |
| Latest indexed launch | `0x26b023e05ea7ee29b8a260e3694cb41923ea46c8` | Curve | 2 | Accepted reported window; 1 buy, 1 sell |
| Custom DEX-paid | `0xade4c2e7152a6bc53c7ecfb523070dfa24e498f1` | Not established | N/A | No usable PONS trade record |

All three usable pages had `trader`, `side`, `quoteAmount`, `tokenAmount`,
`timestamp`, `txHash`, `id=txHash:logIndex`, and a `venue` label. Token, creator,
factory and curve matched the existing indexed launch records. This corroborates
the index; launch provenance was not freshly reverified against factory receipts.
Graduated pages supplied 32-byte pool IDs and an ETH quote descriptor. Venue label
`pool` alone does not establish the exact pool; receipt matching is needed.

The two 50-row pages were ordered newest-to-oldest and reached before the start
of the five-minute window. The two-row curve page had `nextCursor=null`. No extra
pagination was requested. Counts above use the offline replay observation times
18:25:07 / 18:25:59 UTC, after page retrieval. They demonstrate schema/parser
compatibility, **not a guarantee of completeness up to the later replay time**.
A live adapter must bind observations to retrieval time and record HTTP/source
freshness; it cannot treat parsing time as the source's latest indexed block.

### Receipt checks and the key accuracy finding

Robinhood RPC returned chain ID `0x1237` (4663). Three sample transaction receipts
were successful. The two graduated trades matched exact manager/pool/log index,
side and raw swap deltas. Page floating point amounts were consistent with those
deltas, but raw integers remain authoritative.

* Boost buy receipt:
  `0x396d9862d9b19a8e4ca63d3632f7de8374d4f7606e0aaf3f29387326c7c7827d`, log 18.
  Pool output was 872,989.9736901309 tokens. The page trader initiated the
  transaction but received **zero net tokens**. Approximately 4% went to another
  recipient and the remainder passed through several addresses to a different
  final recipient. These flows do not prove who owns those addresses.
* Setup sell receipt:
  `0x00e9165a0dd036791eb0345fbaae33aef5d10db03a4cacb12aa17a3a7082b964`, log 4.
  Swap input and initiator net token debit both matched approximately
  8,539,188.042031521 tokens. A successful past sell does not establish an
  executable future exit at any proposed size.
* Pre-bond receipt: latest page row was a creator sale; mined success and a
  token transfer from creator to the indexed curve were observed. Full curve
  event/quote settlement attribution remains unimplemented in this prototype.

**Change made:** report page wallets as trade **initiators**, not confirmed buyers
or holders. Added an offline exact-log receipt inspector that keeps gross swap
output separate from initiator net token receipt. Beneficiary ownership always
remains unverified and alert eligibility remains false.

## ARC

Official RPC `https://rpc.mainnet.arc.io` returned chain ID `0x13b2` (5042),
a current head and 225 V4 swap logs from a bounded 601-block inclusive range
ending two blocks behind that head. There were 22 pools; maximum logs for one
pool were 102, below the existing verifier's **per-pool** 200-log cap. This single
sample does not justify changing the working verifier or scanning all pools on
an ongoing basis. It also does not prove a five-minute window is complete; that
requires block timestamps and coverage boundaries.

An exact latest swap sample had a successful receipt and matching canonical
block hash, timestamp **18:26:27 UTC**:

* Candidate token: `0x8b445a45cf065e6e2daecde498bc7a4f90c3928e` (HeyGrok).
* Pool: `0x3cd99d907bc063f43e5a9e5b06c4e4c4076cc58999b5e90598681896caa15c8a`.
* Transaction: `0x0d4533f58ddaf08d80254d8e8a4864d9baec58562c49ba13d0f4b55e27f2e113`.
* DEXScreener reported that pool as token/USDC. Receipt pool ID matched; swap
  quote delta was -4,463,500 raw units. It is approximately 4.4635 USDC **if**
  the reported quote membership/decimals are correct. Do not silently certify it.
* Gross token output exceeded the initiator's net token credit. Raw delta:
  96,880,387,234,571,671,211,753 vs 96,870,699,195,848,214,044,632.
* Pool hash did not match the small existing set of plain fee/tick/hook keys
  tested. Exact Initialize/pool-key metadata must be resolved before certifying
  token/quote membership, hooks or this pool's eligibility. This is an identity
  coverage gap, not proof that the pool or token is malicious.

DEXScreener endpoints supply activity aggregates, not a list of independently
owned buyer wallets. Latest public Boost list had zero ARC entries in this single
response; that does not establish the absence of ARC boosts over any time span.

## Decision and next implementation boundary

Live sources are usable for **reported activity research**, with receipt-level
corroboration possible. They do not yet support the proposed Confirmed Demand
claim. Keep the feature offline and the draft unmerged.

Before passive collection: retrieve exact pool-key evidence; bind chain/token/
creator/venue/quote identity; preserve source and block freshness; distinguish
initiators from recipients; retain compact balance checkpoints for the same
beneficiaries. Related-wallet ownership stays unknown unless substantiated.
Exit depth, LP lock state and comparable retest evidence remain separate gates.
Reuse scheduled work with a small shared token/request cap; no broad ARC stream,
per-user polling or new worker. No threshold or success-rate claims from this
small source-validation sample.

Sources: exact-contract pages at `https://ponsfamily.com/launchpad/<token>`,
`https://rpc.mainnet.chain.robinhood.com`, `https://rpc.mainnet.arc.io`, and
`https://api.dexscreener.com/latest/dex/pairs/arc/<pool>`.
Only this compact report is committed; raw page/receipt captures remain temporary.
