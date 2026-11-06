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


## 2026-11-06: encrypted Mac operator recovery + public SOL/USD diagnostic

The operator completed PostgreSQL 17.11 table-level recovery using an encrypted macOS HFS+ sparse image, a separate cluster on local port 5434 and a custom-format `pg_dump` imported by `pg_restore --exit-on-error --single-transaction`. Local restore showed **468** alert-audit rows and **0** legacy BUY-intent rows; a contemporaneous read-only production Supabase query showed the same counts. Both local tables retained primary keys, enabled RLS, and matched production column counts (13/11) and RLS policy counts (0/0). The operator reported clean shutdown and ejection. This validates the two selected tables' recoverability, **not** a complete Supabase restore, bytewise row identity, original grants (dump used `--no-acl`), cross-device backup or perpetual disaster recovery coverage.

Read-only non-executable SOL/USD market cross-check added:
- `src/echo/solUsdIndependentPrice.ts` parses Coinbase SOL-USD product and Kraken SOLUSD ticker, requires both responses received within three seconds, rejects >2% disagreement or missing/invalid quotes, and selects the higher conservative USD-cents quote.
- `scripts/echoSolUsdPublicPriceDiagnostic.ts` makes at most two HTTPS GETs to those fixed public URLs with 2.5-second timeouts. No API keys, private wallet, RPC signing, broadcaster or paid feed. Its explicitly tagged CI job is `echo-sol-fx-public-read-only`.
- A good result establishes **two recently retrieved spot responses only**. Exchange ticker trade timestamps are not independently authenticated; there is no signed oracle, current PumpSwap CPI proof, wallet-debit attestation, manual Phantom SELL simulation or trading authorization. The prior illustrative $200/SOL must **never** be promoted to live pricing.
- Added stale/missing/discordant/duplicate-source and integer-cent rounding rejection tests, wired into Echo-focused CI.
- The existing Railway live signer remains a custody proof with `TRADING=OFF`, on its previous branch. No real-wallet PumpSwap signing or broadcast was run.

**Hard blocks remain:** wallet-funded exact-message successful simulation and observed before/after lamports; bounded unknown CPI and account creation; independently priced Phantom SELL path for every open position; an authenticated signed-but-not-broadcast real-key check under approved operator controls; and separate production migrations/deployment/funding approval. The operator's private data was not uploaded to GitHub.


## Actual dual-spot-FX mainnet diagnostic — 2026-11-06 06:37 UTC

One-shot GitHub Actions run: https://github.com/investlens/solana_alert/actions/runs/42175612436, official SDK @pump-fun/pump-sdk/swap@4.3.1. Inspect the job log for its exact structured `ECHO_TWO_HOP_QUOTE_SIM` result.

- Two public FX responses accepted, conservative upper SOL/USD **8988 cents ($89.88)**, reported source discrepancy **1 basis point**. Both HTTP retrievals occurred in the same 3-second window. The price feed tick ages / signatures are **not** independently proven; this is only a public quote cross-check.
- Built and fee-quoted the exact new six-instruction, 1038-byte unsigned two-hop PumpSwap transaction, **0.042920408 SOL principal**, 10% slippage. SHA-256 `66bb48300160925f25dfd8fb2a85b6a516bba3264447f3258b78671f75253089`.
- Network fee 5,000 lamports; two absent token accounts each provisionally priced 5,852,160 lamports. Conservative known input+fee+ATA envelope **54,629,728 lamports**. Separate **1,000,000 lamport CPI assumption** produced a hypothetical **55,629,728 lamport ($5)** scenario. CPI assumption remains **unverified** and Phantom manual-SELL reserve absent.
- Public RPC wallet balance **0 lamports**. `simulationAttempted=false`, `simulationPassed=false`, `fullWalletDebitVerified=false`, `signed=false`, `broadcast=false`. The intentional nonzero diagnostic exit reason was `INSUFFICIENT_PROVISIONAL_BALANCE`. **Do not treat 54,629,728 or 55,629,728 lamports as a verified funding target or request funding.**
- The production isolated signer still reported `ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`; this is an old custody proof, **not** a real-key signed-and-discarded PumpSwap transaction.

## 2026-11-06 follow-up: inspected independent GitHub Actions logs and no-broadcast integration

- Directly re-fetched GitHub Actions jobs for run [42175612436](https://github.com/investlens/solana_alert/actions/runs/42175612436) (checked out commit `4c5ab54d6ef75bb2aed204a14f5ef9268f0ffd25`). Its `echo` and `echo-five-dollar-postgres` jobs completed successfully, while the intentionally fail-closed `echo-five-usd-mainnet-scenario` job failed with `INSUFFICIENT_PROVISIONAL_BALANCE`.
- Raw diagnostic reports official `@pump-fun/pump-sdk/swap@4.3.1`, six unsigned instructions, 1,038 bytes, exact transaction hash `66bb48300160925f25dfd8fb2a85b6a516bba3264447f3258b78671f75253089`, a 42,920,408-lamport principal and 5,000-lamport network base fee. The wallet returned **0 lamports**. The dynamic estimated total `55,629,728` lamports includes **unverified** CPI allowance and is **NOT** a funding request or validated economic bound.
- `simulationAttempted=false`, `simulationPassed=false`, `cpiWalletDebitsIndependentlyVerified=false`, `signed=false`, `broadcast=false`. The observed SHA-256 authenticates the unsigned build within the diagnostic, **not** independently verified full mainnet transaction effects.
- Added one integrated synthetic flow test covering independently screened caller signal → mock atomic reservation identity → cryptographically signed coordinator admission → immutable mock row → mock independent evidence → durable-mock nonce replay rejection, with signer/broadcast still disabled. This is test-only and **not a production end-to-end result**.
- Added defense-in-depth two-position caps in screen, SQL and manual-exit review, and rejection of malformed signer RPC simulation accounts/inner CPI encoding. Updated legacy signer test fixtures to respect the cap. The draft migration remains unapplied.
- **Latest branch-head CI not independently verified:** do not promote code changes to PASSED merely because an older workflow succeeded. Authentic caller-to-signer delivery, trusted signer-owned CPI source, real Phantom exit and real funded simulation remain BLOCKED.

## 2026-11-06 14:12 UTC — operator requested live auto-BUY; production read-only gate recheck

- Railway production `alphaos-echo-admin`: deployment `73e03032-6ce0-46f0-a83b-8f01be1b785e` (success), pinned to `feat/echo-event-driven-reconciliation-20261101` at `b8943b0bfb74f223972e457c2ef93ed78186de09`, continues `liveTrading:false` and `quoteStage:'NOT_CONNECTED'` in live diagnostic logs. Existing caller alerts are not being replaced by the draft branch.
- Railway isolated service `alphaos-echo-isolated-signer`: deployment `5216b88c-629a-4be6-ac18-0cefe08991ff` (success) pinned to older source `fe4188aeef8bf4b3e7710612199dfefd1f9cfcb3`, operator-controlled key present (value not accessed); runtime proof log `ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`. The signer is **not** a live PumpSwap broadcaster.
- Direct read-only Supabase query on `spwiqtdxfwjlqftujohm`: existing legacy BUY table has **0 intents**, caller audit table has **472 records**, and `to_regclass('public.echo_per_call_buy_intents')` returned **NULL**. Migration remains un-applied.
- New synthetic no-broadcast caller→reservation→signer integration test has been committed. Latest head GitHub commit workflow lookup and combined commit status did not expose a passing run; latest CI outcome **UNKNOWN**. Older green CI is not sufficient.
- No signed PumpSwap transaction, successful funded exact-message simulation, independently bounded full CPI debit, verified Phantom manual SELL, or authentic production one-shot BUY receipt. Latest known wallet balance from prior public RPC diagnostic was **0 SOL**; not a new live balance measurement.
- Release recommendation: do not begin unattended auto-BUY or fund from a provisional `$5` scenario. Verify current real wallet state, correct hard caps against user-approved policy, execute bounded exact quote and full CPI/exit audit with independent evidence, run and pass current CI/disposable PostgreSQL, then obtain separate explicit owner authorization for any production migration/deployment and a funded single live pilot. No key exposure or changes to existing bot.
