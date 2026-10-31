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

## Run 3 — GitHub Actions #41192174322 (final live diagnostic)

- BUY SOL -> USDC: Jupiter HTTP success, router `okx`, builder `errorCode: 1`.
- SELL USDC -> SOL: Jupiter HTTP success, router `dflow`, builder `errorCode: 1`.
- Official Jupiter Swap v2 /order error table: for aggregator routers
  `metis`, `dflow`, `okx`, code 1 means insufficient input-token funds.
- The chosen public wallet cannot build the intended orders in its current
  on-chain funding state. This is NOT evidence of a defective Jupiter route.
- No transactions were built, so there are no resolved ALT accounts or actual
  fee/rent/spend instructions to inspect. No RPC simulation was reached.
- No signing, broadcasts, API secrets, funding, deployments, or production changes.
- Stop repeated keyless /order calls. Do not provision a signer or fund a
  wallet just to force a diagnostic to pass.

## Outcome and next acceptance gate

Status: **BLOCKED ON PUBLIC WALLET INPUT BALANCES**.

Further work requires either a separately authorized, already-funded
read-only wallet address with appropriate SOL/token inputs, or an isolated
simulated ledger state prepared using trusted, reviewable account fixtures.
A quote-only response is not sufficient to validate transaction accounts or
fees. Production signer provisioning remains **NOT APPROVED**.
