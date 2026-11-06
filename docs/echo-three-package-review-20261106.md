# Echo — three work packages, one review set (2026-11-06)

Review-only branch: `feat/echo-five-usd-per-call-safety-20261106`, PR #282.
**No deploy, production migration, real key signing, wallet funding or broadcast.**

## 1. PumpSwap signer-owned debit and CPI envelope

Added `src/echo/signerDebitEnvelope.ts` with integer lamport/USD arithmetic. Requires the exact unsigned transaction hash, signer-owned RPC simulation evidence, independently bounded CPI and rent, and a known manual-exit reserve and outstanding BUY commitments. Rejects unknown components, inconsistent observed payer debit, insufficient SOL, and >$5 all-in entry. Result remains `OFFLINE_COST_ENVELOPE_ONLY`, never executable. Added regression tests.

**Incomplete:** the current signer-owned RPC probe validates fee and blockhash snapshot context, payer balance, and CPI trace structure, but is NOT a completed trusted chain CPI/account-effects adapter. In particular, a synthetic `fullAccountAndCpiProvenanceVerified` value in tests is not independent proof of the on-chain cost. A complete decoder, real funded-state exact-message simulation, account owner and vault validation remain mandatory.

## 2. Phantom manual SELL reserve for multiple positions

Added `src/echo/portfolioExitReserveReview.ts`. Independently quotes each open lot, enforces distinct source signatures, same wallet/mint, full-balance SELL, fresh evidence, no double counting of already-booked exits, and reserves all SELL fees before considering any future proceeds. Rejects missing exit routes, stale/partial quotes or insufficient SOL. Added two-lot and negative regression tests.

**Incomplete:** no real Phantom SELL transaction/route was observed and no real position exists in the unfunded wallet. A wallet-app exit estimate cannot be certified from synthetic quote booleans. Do not infer the needed funding amount from these tests.

## 3. Integrated one-shot release gate

Added `src/echo/integratedNoBroadcastReleaseGate.ts`. Combines the entry envelope and independently priced portfolio exits with verification of caller ownership, durable signature dedupe, atomic wallet reservations, nonce, real CPI adapter, real wallet simulation, manual exit proof, isolated real-key signed-and-discarded verification, and admin kill switch. Added separate reconciler: the booked exit reserve must cover all independently quoted open-position exits and the all-in wallet requirement must reconcile with pending commitments. This result **never authorizes signing, deployment or broadcast**, even if test fixtures say everything passed.

**Incomplete:** no real isolated-key signed/discarded test, no verified funded-wallet simulation, no production migration or end-to-end caller BUY → live follower transaction evidence. Owner separately approves migration/deployment, wallet funding, one bounded live pilot, and eventually unattended auto-BUY.

## No misleading completion claim

The above completes the three **code review packages** and regression cases, subject to latest GitHub CI. It does **not** complete the entire real-money automatic trading system. Production must remain trading OFF until real-world evidence and owner approvals pass. Earlier illustrative FX and cost figures are not a funding target.
