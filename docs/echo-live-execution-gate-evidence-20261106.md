# Echo real-execution acceptance: independently observed evidence (2026-11-06)

All production inspections below were **read-only**, via Supabase and Railway connectors. No secrets were accessed and no production changes were made. Draft implementation: PR #282, `feat/echo-five-usd-per-call-safety-20261106`.

## Observed production state

- Supabase project `spwiqtdxfwjlqftujohm`: active/healthy PostgreSQL **17.6**.
- Existing `public.echo_live_buy_intents`: **0 rows** at inspection. **Actual schema has 11 columns and NO `position_closed_at` column**. Existing `public.echo_caller_alert_audit`: **467 rows**.
- Proposed `public.echo_per_call_buy_intents`: **NOT DEPLOYED**. Its DDL is review-only.
- Railway `alphaos-engine`, production signer `alphaos-echo-isolated-signer`: latest deployment status SUCCESS. Service starts `node --import tsx scripts/echoIsolatedSignerProveOnce.ts` from `feat/echo-pilot-total-budget-guard-20261102`. Runtime log: **`ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`**. This proves pinned-wallet custody in the existing one-shot service, **NOT** a signature of the new PumpSwap BUY.
- Existing `alphaos-echo-admin`: separate successful deployed service on `feat/echo-event-driven-reconciliation-20261101`. Production deployments remain untouched.

## Observed alert latency (read-only SQL)

From `echo_caller_alert_audit` rows with `trade_at > now()-interval '2 days'` and non-null acceptance timestamps (values are milliseconds between stored trade and accepted timestamps):

| Caller | BUY records | Median | P95 | Maximum |
|--|--:|--:|--:|--:|
| Chairman | 50 | 1,992 ms | 2,725 ms | 3,261 ms |
| Slingoor | 34 | 2,307 ms | 4,145 ms | 7,315 ms |

These are **not** a measurement of chain BUY to executed follower BUY, and include database timestamp precision uncertainty. They prove that, even *before* quote, nonce, signer and RPC submission, portions of the observed detection+acceptance distribution exceed 3 seconds. The new fast-follower execution path needs **separate real measurements** to satisfy a full 1–3-second goal.

## Production-schema adaptation

The review-only SQL now checks for **any** un-reconciled legacy wallet intent rather than referencing non-existent `legacy.position_closed_at`. The new reservation model reserves pending/UNKNOWN BUY debits and all outstanding manual SELL costs, without subtracting already-confirmed BUYs again from current on-chain wallet balance. PostgreSQL 17 disposable integration tests explicitly reproduce the true 11-column legacy table and assert confirmed debit / SELL reserve math.

## Existing mainnet unsigned diagnostic

Official PumpSwap two-hop SDK build **succeeded** with input **0.025 SOL**, six unsigned instructions and a fee-aware quote. Wallet balance **0 SOL**; unsigned simulation **not attempted** because even the provisional wallet-debit floor was **0.03670932 SOL** with absent ATA upper bounds. Actual CPI wallet debits and Phantom manual SELL reserve **not verified**. This diagnostic **does not** satisfy the new $5 all-in dynamic trade rule.

## Required release gates not yet met

1. Signed-off, independently restored encrypted backup with verified recovery of real production data (not only synthetically created Postgres tables).
2. Exact dynamically sized official Pump.fun/PumpSwap quote and instruction-message proof, including at most 10% slippage and independently bounded network, priority, ATA and CPI debits.
3. Successful real-wallet-state unsigned `simulateTransaction` and independently verified manual Phantom SELL reserve.
4. Authenticated, real isolated-wallet signed-but-not-broadcast PumpSwap message test. No secret in GitHub, chat, stdout or Telegram.
5. Production review-only migration applied **only after** recovery approval; restart, replay, simultaneous calls, one-shot submission and manual OFF validated against the actual deployed pipeline.
6. Measured actual eligible caller on-chain BUY → follower RPC submit p95 (target ≤3 s, network permitting), before any claim of 1–3-second delivery.
7. Explicit owner approval for wallet funding and one bounded live test, and separate approval before unattended trade broadcast.

**Release status: BLOCKED.** No automatic BUY or real-money transaction has been activated.

## Read-only dynamic $5 scenario diagnostic — 2026-11-06 05:06 UTC

GitHub Actions job: https://github.com/investlens/solana_alert/actions/runs/42166418763. Runs only on an explicitly tagged commit; action deliberately exits nonzero when no **successful funded-state simulation** exists.

Official SDK `@pump-fun/pump-sdk/swap@4.3.1` read pool/fee state, compiled 6 unsigned instructions, then recalculated its **SOL input** after conservative ATA rent, network fee and a declared extra CPI *assumption*. It **rebuilt** the quote and exact unsigned transaction for that input instead of treating the old fixed 0.025 SOL order as a $5 order.

- Illustrative input FX **$200/SOL** (20,000 cents per SOL), supplied by the test workflow. **Not a verified market-price feed.**
- Provisional CPI allowance **1,000,000 lamports**; **not independently verified**.
- Exact new SOL principal: **12,290,680 lamports** (0.01229068 SOL).
- New quote output raw: `5254832974971`; quoted minimum output raw `4729349677473` (10% slippage scenario).
- Network fee 5,000 lamports, 2 missing ATA accounts each budgeted at 5,852,160 lamports.
- Fee/rent/principal subtotal: **24,000,000 lamports**; plus assumed CPI buffer: **25,000,000 lamports**, exactly $5 at hypothetical FX. This is NOT a complete CPI audit or safe transfer amount.
- Unsigned transaction SHA-256: `4dea85dc6d5d8602209876d1dbf519eea4b32346ed4100e35f5e18c9bca23368`.
- Zero SOL actual wallet; `simulationAttempted=false`, `fullWalletDebitVerified=false`, `signed=false`, `broadcast=false`; nine read-only RPC calls.
- **No Phantom manual-SELL reserve priced**. The $5 cap is an entry cap, not a wallet-funding estimate.
- The new unsigned simulator explicitly requests fee-payer post-simulation account state via RPC; it fails closed on missing measured payer balance. That route has not yet produced results from a funded wallet.

The next stage requires actual current FX attestation, independent CPI/ATA proof, Phantom exit reserve, and funded-state RPC simulation. Do **NOT** transfer 0.025 SOL based on this demonstration. Database restore remains operator-only; current connector read-only inspection is not an off-site pg_dump and does not qualify as a recovery drill.
