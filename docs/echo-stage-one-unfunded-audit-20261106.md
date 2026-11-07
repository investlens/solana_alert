# AlphaOS Echo — Stage 1 unfunded safety audit (2026-11-06)

**Verdict: PARTIALLY VERIFIED / STAGE 1 NOT COMPLETE.** No signing, funding, trading, deployment or production mutation is approved by this file.

## Independently observed evidence

1. Official PumpSwap SDK mainnet diagnostic logged in GitHub Actions [run #42175612436](https://github.com/investlens/solana_alert/actions/runs/42175612436): SDK `@pump-fun/pump-sdk/swap@4.3.1`, six unsigned instructions, 1,038 bytes, SHA-256 `66bb48300160925f25dfd8fb2a85b6a516bba3264447f3258b78671f75253089`. Two-hop quote verified in the historical run, but only a specific historical token/pool, not future caller mints.
2. Raw log recorded current-at-that-time wallet balance **0 SOL**, principal **42,920,408 lamports**, network base fee **5,000 lamports**, two absent ATAs with conservative read-only rent allowance **5,852,160 lamports each**. Simulation was **not attempted**; network fee and rent are historic, not a new live price.
3. Historical *known + provisional ATA* debit floor: `42,920,408 + 5,000 + 2*5,852,160 = 54,629,728 lamports` (**0.054629728 SOL**). This is **not** a conservative full funding estimate because unknown CPI/extra debits, priority fee variance, Phantom manual SELL reserve, and pending commitments are excluded. The historical scenario's additional **1,000,000 lamports** CPI was explicitly an unverified assumption. At the historic two-source SOL/USD cross-check (~$89.88), the 55,629,728-lamport *assumption-based* scenario was ~ $5, but does not provide a verified maximum.
4. Existing `pumpUnsignedPerCallHandoff` verifies signed-domain-less exact unsigned SHA-256, signer identity, top-level PumpSwap allowlisted program, single allowed System transfer, slippage/fee checks and synthetic attestations. **Not sufficient** to audit actual pool vault owners/mint continuity and all CPI lamport/token deltas for the signed message. Raw simulation CPI inspector only validates structure and therefore returns `completeWalletDebitProven:false`.
5. Review-only SQL enforces signature dedupe, two concurrent open/pending lots, $5 all-in ceiling, atomic serialization, exit reserves and fail-closed unknown submissions; prior disposable PostgreSQL 17 workflow previously passed **before latest code changes**. New branch-head CI has no confirmed passing result (GitHub connector's commit workflow lookup is incomplete for push workflows).
6. Read-only production inspection found `echo_per_call_buy_intents` **absent** in Supabase and older commits deployed in Railway. That is expected at Stage 1; no production SQL or running service was modified.

## Exact remaining unfunded Stage 1 blockers

- [ ] Obtain independently validated instruction/account-owner/mint/vault snapshots for the **exact dynamically sized** PumpSwap route on a fresh verified caller BUY.
- [ ] Establish a protocol-audited upper bound for **all** signer CPI / rent / ATA / priority fee changes without treating a guessed 1m lamport CPI allowance as proof.
- [ ] Derive an independently verified full-balance Phantom-compatible manual SELL route + per-lot SOL fee/rent reserve before recommending a deposit.
- [ ] Execute and observe current-commit typecheck, synthetic no-broadcast integration tests, and disposable PostgreSQL race test passing. Existing test source in GitHub is not proof it passed.
- [ ] Review production deployment/migration plans for source revision pinning, kill-switch, immutable DB records, nonce and one-shot submission recovery. Stage 1 cannot authorize production migration/deployment.

## Stage 1 automated gate

`src/echo/unfundedStageOneReadiness.ts` + `tests/echoUnfundedStageOneReadiness.test.ts` require all identified evidence components and a passing current CI before returning `completed:true`. **These are pure validation and synthetic regression tests, not independent evidence acquisition**, and the gate always returns `canFund:false`, `canSign:false`, `canBroadcast:false`.

## The funding question

**NO VERIFIED SOL DEPOSIT AMOUNT IS AVAILABLE YET.** An unfunded-wallet simulation cannot establish its final actual effects, but Stage 1 should first calculate a justified worst-case budget from audited protocol mechanics, fresh fee/rent reads, FX and a real manual exit quote, rather than requiring the user to fund from an unjustified circular estimate.

Any later, separately authorized funding amount must cover: exact $5 **maximum all-in BUY debit**, plus independently bounded manual SELL reserve for every active lot, plus any pending commitments and operator-selected headroom. Deposit is not a trading authorization. The first purchase needs a separate explicit approval after funded-state no-broadcast success. Do not publish or transport a private key.
