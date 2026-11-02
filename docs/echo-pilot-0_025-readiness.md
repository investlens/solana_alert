# Echo 0.025 SOL pilot verification (2026-11-02)
**Status: BLOCKED FOR FUNDING AND LIVE EXECUTION.** Only isolated branch `feat/echo-pilot-total-budget-guard-20261102` modified. Production remains proof-only; no trades signed or transmitted.

## Confirmed
- Dedicated wallet `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ` proved off-chain cryptographic control in isolated Railway one-shot run `5216b88c-629a-4be6-ac18-0cefe08991ff`; sealed key now confirmed.
- 0.025 SOL fixed owner-sizing preview = exactly 25,000,000 lamports. Read-only preview independently reconciles this amount to supplied USD principal and all-in fees. No client-controlled live authorization and no switch-on.
- CI for `5cfca92092e82a09479dcd36c3c68b182d76005b` passed: TS typecheck, Echo-focused tests, historical read-only classifier replay, and full repository tests.
- Database `public.echo_live_buy_intents` exists with PK on (execution_wallet,mint), amount <=0.1 SOL and 0 rows at review time. This proves a duplicate unique key constraint exists, NOT end-to-end reservation or restart safety.

## Real mainnet route check
- 0.025 SOL bounded PumpPortal local builder test via run `41502056738`: one builder request, zero simulation requests; returned `UNSIGNED_BUILDER_UNAVAILABLE`, no unsigned bytes, no signer involvement, no broadcast. Second single bounded diagnostic run `41502390386` safely recorded **HTTP 400**, one builder request and zero simulations. The static test mint/pool/parameters require verification; no additional blind retries. Status only was logged, not response body or credentials.
- PumpPortal is THIRD PARTY (not official Pump.fun API); local builder availability and onchain account/ALT/CPI validation remain unresolved. No repeated provider probing until meaningful diagnosis. Never use lightning endpoint for this credential: it is a broadcast service.
- The static example mint is not a freshly verified live caller trade; success with it would not establish under-$100k market-cap or caller-price eligibility.

## Required before asking user to fund
1. Produce current real unsigned 0.025 SOL BUY for a vetted supported pump or pump-amm token, then independently validate fee payer, mint, destination ATA, swap economics, compute/priority costs, untrusted instructions and lookup tables.
2. Run bounded `simulateTransaction` on the exact unsigned bytes. A failure or unverified transaction must never unlock signing.
3. Inside isolated signer only, authenticate a one-time coordinator request, independently revalidate exact transaction SHA256, nonce, signed caller BUY, and trusted atomic reservation, then cryptographically sign and discard bytes WITHOUT RPC broadcast. Off-chain wallet ownership proof alone is NOT this test.
4. Apply reviewed schema migrations only after security review/backup. `docs/sql/echo-pilot-all-in-atomic.sql`, `echo-pilot-one-shot-submission.sql`, and `echo-signer-nonce-replay-journal.sql` remain unapplied; the current DB table does not have their budget ledger / one-shot fields.
5. Verify Phantom access to the same wallet and test manual SELL with real token balance only after approved first BUY. No automatic sell.
6. Confirm live fees, SOL/USD and $10 all-in per BUY, $30 lifetime budget, $0.025 SOL initial size, max two open/pending, one BUY per mint. Larger 0.1 or 0.2 SOL tiers need separate owner approval AND revision of the USD limits; never simply expose them as immediately spendable.
7. Verify funds and fee/exit reserve then explicitly request owner approval before any mainnet send. A proposed 0.1 SOL wallet deposit does NOT authorize spending 0.1 SOL.

A second bounded status-only diagnostic may be used to classify provider refusal; no signing or broadcast permitted.

## 2026-11-02 pool correction and bounded diagnostics
- Public market observation for static mint `D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump` identified a principal **PumpSwap** (graduated) pool (`JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8`) and a historical snapshot market capitalization **over $100K**. This test mint is NOT eligible for live pilot purchases; provider market data is not itself trusted price/route execution proof.
- Changed diagnostic pool from `auto` to `pump-amm`. GitHub Actions `41502746144` still returned HTTP 400 at the *unsigned local builder*, before any RPC simulation.
- Added a bounded, no-body logging error-category classifier to the isolated READ-ONLY builder. GitHub Actions `41502939467` returned `builderHttpStatus=400`, `builderFailureCategory=UNCLASSIFIED`, one builder call, zero simulation calls, zero signed or transmitted transactions.
- Do NOT assert insufficient wallet balance as cause; endpoint returned no recognizable reason. Further blind retries are prohibited. Obtain verified current pool/mint onchain (including the pump vs pump-amm switch) and prefer a locally auditable first-party instruction builder or another reviewed unsigned route. Fresh real caller token for deployment must independently satisfy < $100k market cap, verified buyer entry price, liquidity and sellability.
- Current signer remains on proof-only `echoIsolatedSignerProveOnce.ts`, no RPC and no BUY signing. Funding NOT approved.

## First-party SDK transition (2026-11-02)
- Confirmed official `@pump-fun/pump-sdk` 4.3.1 consolidates PumpSwap under `@pump-fun/pump-sdk/swap`; official `OnlinePumpAmmSdk` can fetch verified pool state and `PUMP_AMM_SDK.buyQuoteInput` can generate instructions without private keys.
- Added `scripts/echoOfficialPumpSwapUnsignedProbe.ts` as a standalone read-only, static-wallet proof, with pinned 0.025 SOL request, strict mainnet RPC allowlist/request limit, explicit candidate PumpSwap pool+mint and instruction program checks, ZERO signing/broadcast. SDK installs only within an explicitly tagged, isolated CI test: no production package or lockfile changed.
- Test run `41503737763` launched. A failed SDK run must never be interpreted as live-ready. Full typecheck and probe status need verification before advancing. Existing wallet unfunded, so even a valid transaction cannot be claimed to have passed a funded simulation without independent evidence.
- If SDK structural build passes but current-wallet simulation cannot, record this as BUILT_ONLY, not a live simulation pass. No real wallet signing, no funding approval.
