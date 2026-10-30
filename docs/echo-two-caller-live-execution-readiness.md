# AlphaOS Echo: two-caller $10 live-execution readiness (DRAFT / NO DEPLOY)

## Pilot policy
- Eligible signal wallets: Slingoor and Chairman, verified BUY swaps only.
- $10 principal per BUY, max two open/pending positions and $20 principal exposed.
- Three new buys per UTC day; one lifetime BUY reservation per wallet+mint.
- Ignore additional BUY signals when two slots are occupied; still send caller alerts.
- Manual SELL 50% or 100%, owner-only, never automatic. 50% SELL does not free a slot.
- Full SELL frees one slot **only after independent chain proof** of confirmed sell,
  zero remaining position balance, verified proceeds and persisted signature.
- Uncertain transactions hold their slots; NEVER blindly submit again.
- Stop-buy switch blocks new purchases but must leave owner manual exits available.

## Implemented on draft branch
- Strict caller/size guard and SQL proposal for serialized atomic reservations.
- Supabase RPC adapter (not deployed, schema not applied).
- Unsigned transaction envelope structural inspection (not complete economic audit).
- Signed transaction RPC submission adapter, compiled hard-OFF.
- Read-only chain status adapter and durable signature reconciliation.
- Manual sell admission and shared execution transport boundary, compiled hard-OFF.
- Focused tests added to Echo CI workflow; latest CI outcome must be independently verified.

## Critical remaining integration gates — all required before first real trade
1. Verify who controls execution wallet
   `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ` by challenge signature,
   not merely by public key or Railway environment variable.
2. Create independent authenticated signer process with secure key custody. The
   alert worker must never receive private key, seed, or signing privilege.
3. Implement trusted Pump.fun/Jupiter BUY **and SELL** transaction builder:
   resolve address lookup tables if used, validate every invoked program and account,
   quote expiry, explicit input/output token mint and balance deltas, slippage and
   compute/priority fees. Current allowlist/preview is intentionally insufficient.
4. Implement independently verifiable signer-side authorization sourced from DB,
   not self-reported client booleans; enforce replay resistance and one active
   reservation per wallet/mint across all replicas.
5. Persist signed transaction fingerprint and signature **before** any RPC
   submission; confirm on chain; reconcile uncertain outcomes after restart.
6. Implement chain-proven buy/sell settlements in the database, especially
   partial sells and full-close state. Require independently verified balance
   and proceeds before freeing a slot.
7. Connect authenticated owner-only Telegram callbacks to that verifier/executor,
   without creating a competing Telegram polling/webhook consumer.
8. Realistic end-to-end simulation and adversarial tests for:
   concurrent buys, duplicated callbacks, stale/slipped quotes, 50%/100% sells,
   wallet mismatch, wrong/malicious destinations, failed/reorged/timeout transactions,
   restart while unknown, priority-fee exhaustion, kill switch, and chain confirmation.
9. Verify full CI/typecheck, observe an alert-only deployment, audit RPC/provider
   volume and complete a reviewed rollout plan. Obtain fresh explicit approval for
   real activation and wallet funding.

## Hard safety gates
- `src/core/adminTrading.ts`: permanently disabled; do not weaken.
- `ECHO_LIVE_SUBMISSION_COMPILED_ENABLED=false`
- `ECHO_SIGNER_ENABLED=false`
- `ECHO_MANUAL_SELL_BROADCAST_ENABLED=false`
- `ECHO_REAL_BUY_ENABLED=false`, `ECHO_REAL_SELL_ENABLED=false`
- Existing main `solana-alert-bot` must remain untouched.

No migration, service deployment, real trading, or wallet funding is authorized
by merging the draft modules. Do not call this release live-deployment-ready.
