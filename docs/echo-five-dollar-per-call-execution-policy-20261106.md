# Echo execution policy change request — 2026-11-06 (not deployed)

User-requested strategy change, for review and implementation on an isolated branch before any live activation.

## Updated execution intent
- Only **Slingoor** and **Chairman** verified on-chain own BUY swaps; transfers, gifts, and failed transactions are not calls.
- Target **$5 USD all-in per eligible observed CALLER BUY**, with conversion from fresh independent SOL/USD source and a maximum wallet debit that includes network/priority fees, transaction rent, and all wallet-funded CPI costs; reject when these costs cannot be bounded. Never spend more than $5 per event merely because the SOL price moves.
- A *new on-chain source transaction signature* for a previously purchased mint is eligible for a new $5 purchase, including when another position in that mint is currently held. Do not mistake duplicated webhook/RPC/Telegram notifications, restarts, replays or multi-path classification of the SAME source signature for new calls.
- **Minimum pre-BUY effective wallet balance: $6 USD inclusive.** If the independently verified wallet balance less still-pending reserved debits is below $6, do not reserve, sign, or BUY. At exactly $6, the remaining independent $5 all-in purchase, fee and manual SELL reserve checks still apply. This is not a $6 required post-trade balance.
- Remove the old $30 lifetime committed-budget constraint **from the proposed strategy**. Retain an independently enforced available-wallet SOL limit, mandatory manual-SELL network reserve, fee ceiling, kill switch, signed one-shot submission and account permission boundaries. Never allow unbounded SOL debit.
- Manual Phantom SELL only. No automatic selling, no re-broadcast or retry after an uncertain send. A failed transaction must be investigated/reconciled before any other execution is authorized for the same caller transaction.
- New mandatory entry filter: token market capitalization must be **at or below $500,000 USD** using verified fresh market cap (not FDV); any value above $500,000 must reject. Previously agreed maximum slippage 10% and +50% verified caller-price premium continue unless separately revised; no liquidity/honeypot eligibility for these two callers.
- **Multiple active positions and repeat buys are allowed. Remove the old 2-open-trade limit** from the proposed per-call strategy. Keep atomic wallet-balance and pending transaction accounting, the $5 all-in ceiling on *every* new call, the exit reserve, kill switch, and per-source one-shot protections. Remove any old daily action limit from this new proposed path.
- Real-money signing and broadcasting are **OFF** until verified independent production recovery, accepted transaction simulation against real wallet state, verified fee and CPI wallet debit bound, preflight manual exit path, authenticated isolated signer signed-and-discarded test, end-to-end no-broadcast acceptance, and explicit separate launch approval.

## Data model changes required
The old unique identity `(execution_wallet, mint)` rejects deliberate repeat BUY. Preserve this identity as *position aggregation* or split a dedicated positions table, but create an immutable **per-call purchase-intent identity** such as `(execution_wallet, caller_wallet, source_signature, mint)` with a unique constraint. If the same real source transaction is observed again, return idempotent ALREADY_SEEN, never submit a new on-chain transaction. A second independent caller signature may reserve a second lot for the same mint, subject to hard risk checks. A durable one-shot send state and nonce must be transaction-lot scoped, not token scoped. Verify chain receipt and cost basis separately per lot, aggregate wallet inventory for manual Phantom SELL and close only after independently confirmed chain state.

## Acceptance tests before release
1. Same source transaction delivered 5 ways concurrently -> one intent, one signed message, <=1 broadcast.
2. Same mint and 4 distinct valid source signatures -> 4 intents, each <=$5 all-in, provided wallet balance covers committed and SELL-reserve costs; no duplicate submission.
2a. Market cap $500,000 -> eligible at boundary; $500,000.01 -> reject even if other checks pass.
3. Missing/incorrect USD conversion, CPI fee, rent, or SELL reserve -> fail closed without signing.
4. Effective verified pre-BUY wallet balance $5.99 -> reject, $6.00 -> pass the threshold only if all fees, pending debits and SELL reserve fit; kill switch always rejects.
5. Restart or network failure after UNKNOWN submission -> reconcile on chain; no rebroadcast.
6. Out-of-order source signature replay or a transfer classified as BUY -> no buy.
7. No duplicate wallet-account deductions and no slot release from merely owner-reported manual SELL.
8. Isolated signer verifies pinned transaction bytes and durable nonce and discards real-wallet signature without broadcasting.
9. Existing Echo admin alerts and original AlphaOS main bot unchanged.

## Production release gate
**NO schema migrations, signing, wallet funding, new recurring costs, or deployment by virtue of this document.** Production still runs the earlier rules. This policy must be turned into reviewed code+SQL, tested on independent clusters and validated against actual recovery evidence before live use.
