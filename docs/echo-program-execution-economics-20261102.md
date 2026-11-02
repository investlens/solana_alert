# Echo read-only program trust and real execution economics (2026-11-02)

## Critical security findings (observed, not assumed)
- Third-party PumpPortal Local builder's sampled unsigned transaction invoked `FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe`, **not** one of the canonical Pump protocol IDs listed by `pump-fun/pump-public-docs`.
- On-chain inspection (Actions #41385928807, two `getAccountInfo` calls) confirmed executable=true, upgradeable loader, **upgrade authority exists**, deployment slot `416108084`, program-data ACCOUNT SHA256 `a19ff371fab929ed5224135f9e30064ef50b5e65ac5f8a7dc9a4e75a581e50b4`.
- This SHA is NOT a reproducible/verified source build; program behavior can change under the upgrade authority. The external program's CPI, lamport/token debit semantics, immutable fee recipients and exact fees are NOT independently verified. **Do not whitelist it for signing.**
- Canonical Pump IDs from official primary source: bonding curve `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`, PumpFees `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`. IDs alone do not validate current executable binary bytes.
- Primary references: https://github.com/pump-fun/pump-public-docs , https://pump.fun/docs/fees , https://pumpportal.fun/fees/ .

## Cost estimate policy
- On a pre-graduation standard bonding curve, official Pump documentation lists **1.25% trading fees**. On graduated PumpSwap pools, fee tiers vary; some other token-pair/holder-rewards configurations also differ. Never infer one percentage from symbol or token age.
- Third-party PumpPortal Local API separately publishes a **0.5% per executed trade** builder fee (calculated before slippage). Do not assume this cost applies to a direct SDK-built transaction with no third-party intermediary.
- Network fees, priority fees/tips, account rent/deposits, and slippage are separate. A successful unsigned transaction with 0 explicit CU price is NOT free.
- `reviewEchoRoundTripEconomics` is a **conservative stress scenario**, not actual execution P/L. It only evaluates if buy and sell independently priced SOL amounts and every fee input are known. If quote prices already include venue costs, an operator must prevent fee double counting before treating any result as a realistic estimate. The output must never authorize execution.
- A true *realized* result requires independent confirmed signer-owned BUY/SELL receipts, a fully closed position, and separate attribution of any external lamport transfers/rent. `reconcileEchoObservedRoundTrip` reports wallet net SOL movement including network fees but flags exact protocol/third-party fee attribution as unverified.

## What is still NOT accepted
1. No independently verified source/reproducible build or fully audited instruction semantics for `FAdo9NCw...`; unknown CPI is a signer blocker.
2. No **funded, independently owner-confirmed** dedicated Echo wallet. The previously sampled public wallet held 0 SOL and its custody is unverified.
3. No successful mainnet BUY and SELL simulation using the authenticated wallet, independent route quotes, resolved ALT snapshot at signing time and fully verified destination/balance changes.
4. No tested live broadcast/reconciliation integration; auto-BUY and auto-SELL remain OFF, manual execution OFF. Main AlphaOS bot must not be touched.
5. Do not conflate green unit/CI tests with proven mainnet execution profits, never fund by default.

## Recommended safer next engineering route
Build an **unsigned** trade via the official Pump SDK (pin version, known official program IDs, independent account/fee review) in the isolated research branch; compare it with the third-party builder while executing neither. Prove protocol instruction discriminators, exact fee recipient and buy/sell output constraints against official IDL. Use one trusted current-slot mainnet state read/simulation if feasible; reject provider failures, wallet insufficient balance, unknown CPI and slippage changes. Only then consider secure isolated signing architecture and request separate deployment / live-money approval.
