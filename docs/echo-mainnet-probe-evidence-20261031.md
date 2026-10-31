# Echo mainnet read-only BUY/SELL acceptance evidence

Date: 2026-10-31. Production trading remains OFF. Do not provision a signer from these results.

## Run 1 — GitHub Actions #41191972755

- Source: one-time, explicitly marked GitHub Actions job on draft PR #267
- No private keys, trading secrets, Jupiter /execute, or sendTransaction calls
- BUY: 0.01 SOL -> USDC, public Phantom wallet, `NOT_VERIFIED / JUPITER_ORDER_MISMATCH`
- SELL: 0.01 USDC -> SOL, same public wallet, `NOT_VERIFIED / JUPITER_ORDER_MISMATCH`
- Neither reached Solana RPC simulation; no swap was executed.
- Broad validation error traced to fields not guaranteed in the documented Jupiter /order response.
- The validator now checks optional echoed fields only when present and classifies
  actual /order failures before attempting read-only simulation.

## Run 2

The next explicitly marked CI diagnostic will use exactly two keyless
`GET /swap/v2/order` requests with the same public input. Results must
be copied from the CI job logs here after completing; a successful build
without a successful RPC simulation is NOT a pass.

## Acceptance still pending

1. Built unsigned BUY and SELL routes with independently verified account mappings.
2. Actual Solana RPC simulations, including balance-blocked failure classification.
3. Fee/rent/slippage/priority accounting and writable-account allowlisting.
4. Dedicated signer design audit. No secrets or broadcasts in this phase.

NO LIVE TRADING. No production database or Railway changes.

## Run 2 — GitHub Actions #41192075761

- BUY: `NOT_VERIFIED / JUPITER_ORDER_BUILD_ERROR`
- SELL: `NOT_VERIFIED / JUPITER_ORDER_BUILD_ERROR`
- Both requests returned a Jupiter /order error code, but previous diagnostics
  did not retain numeric error metadata. No Solana simulation was attempted.
- One final low-volume diagnostic reports only bounded numeric error code and
  a whitelisted router identifier, never transaction or credential payloads.

## Run 3

Record the final result from the one-time CI probe before deciding whether
additional Jupiter calls are justified. Keep live trading OFF.
