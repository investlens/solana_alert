# AlphaOS Echo isolated signer actual-RPC test runner — 2026-11-07

**Artifact:** `scripts/echoSignerNoBroadcastTestOnce.ts`, one-shot diagnostic with no wallet secret, private-key handling, HTTP listener, trade submission or database mutation.

## Operational deployment contract

Only launch in a separately approved TEST-ONLY environment/image (or an explicitly approved isolated signer update). **Never replace `alphaos-echo-admin` or its working Telegram alerts.** The current production signer is a sealed custody proof, not this runner.

1. Pin the official `@pump-fun/pump-sdk/swap` version and lockfile in the isolated test image; its dependency is currently **NOT** in the application's `package.json`. Without a package-backed adapter the runner rejects with `PINNED_OFFICIAL_PUMP_SDK_NOT_INSTALLED`. Never fetch an npm package dynamically at runtime.
2. Prepare exact **unsigned** official-SDK-constructed BUY transaction bytes against the dedicated pinned payer `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ`. No other signer, no lookup tables, no signed bytes. Route must derive first and second pool, intermediate mint, target mint from trusted on-chain state; no Telegram payload or attacker-specified account substitutions.
3. Configure the TEST-ONLY environment with:
   - `ECHO_SIGNER_TEST_ONLY=true`
   - `ECHO_SIGNER_MODE=PROOF_ONLY`
   - `ECHO_SIGNER_BROADCAST_ENABLED=false`
   - `ECHO_SIGNER_REQUESTS_ENABLED=false`
   - `ECHO_SIGNER_EXPECTED_WALLET`: pinned dedicated wallet public address
   - `ECHO_SIGNER_TEST_RPC_URL`: approved HTTPS Solana RPC endpoint
   - `ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64`: exact unsigned transaction bytes
   - `ECHO_SIGNER_TEST_FIRST_POOL`, `ECHO_SIGNER_TEST_SECOND_POOL`, `ECHO_SIGNER_TEST_INTERMEDIATE_MINT`, `ECHO_SIGNER_TEST_TARGET_MINT`
   - `ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS`, `ECHO_SIGNER_TEST_SLIPPAGE_BPS` (1–1000)
4. One-shot invocation: `node --import tsx scripts/echoSignerNoBroadcastTestOnce.ts`. Script exits nonzero when BLOCKED and emits only a compact, sanitized status and reason (never private keys, raw RPC responses or unsigned bytes).
5. Required before any activation: current HEAD CI including `tests/echoSignerNoBroadcastTestOnce.test.ts`; funded-wallet exact-message RPC simulation; independently decoded all CPI and token-account effects; independently bounded **full** Phantom SELL reserve; durable owner ON/OFF enforcement at last signer/send gate; separately approved small, single-purchase pilot.

## Precise security limitations

This runner obtains *actual RPC* evidence only when correctly configured and the reviewed SDK is installed. It verifies official decoded pool route/quote and exact unsigned message, then uses the existing signer-side account/fee/simulation probe. Successful output is **PROVISIONAL**, never approval for a real trade: the current probe only validates structural CPI trace, not full token-account deltas, and no Phantom wallet-app sale has been verified.

It deliberately has **no signing key or transaction signing implementation**, so it is not yet an authenticated signed-and-discarded proof, let alone a live executor. A passing synthetic CI test verifies guards and API contracts, **not** that an actual funded mainnet BUY passed.

## Runtime evidence (read-only Railway)

2026-11-07: production signer commit `fe4188ae` still runs `echoIsolatedSignerProveOnce.ts`; last successful `ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`. Admin service commit `b8943b0b` logs `quoteStage:'NOT_CONNECTED'` and `reservationStage:'NOT_CONNECTED'`. No current-head live signer-side end-to-end test has passed.
