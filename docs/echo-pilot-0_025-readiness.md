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

## Official SDK proof: real public pool composition, not SOL-paired
- GitHub Action `41503737763` installed official `@pump-fun/pump-sdk@4.3.1` in an ephemeral job and called `OnlinePumpAmmSdk.swapSolanaState` successfully (3 public mainnet RPC reads). Initial one-hop builder intentionally rejected the public pool pair before constructing a transaction. No secrets or signing.
- Public account inspection in run `41504084665` verified target pool base mint `D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump` and **quote mint** `qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump` (NOT WSOL). Therefore this test requires SOL -> quote pump coin -> target token, subject to checking a canonical eligible first hop.
- First-party Pump documentation explicitly provides `multi_hop_swap` for such routes; it handles account continuity and fees across two or more pool/curve hops. `OnlinePumpSdk.resolveMultiHopRoute` and `PUMP_SDK.multiHopSwapInstructions` require additional audited integration before a 0.025 SOL unsigned multi-hop transaction may be built. No real simulation passed. The static test token is NOT pilot-eligible based on recorded market-cap evidence.
- Prototype has been corrected to mark this state `MULTIHOP_REQUIRED_NOT_IMPLEMENTED` instead of the inaccurate generic pool failure. Added `officialPumpRouteAdmission.ts` + unit tests for onchain-verified canonical pool routes, max three hops, continuous SOL-to-intermediate-to-target, no mayhem and no execution capability. A fabricated first hop in tests is only a fixture, never onchain attestation.
- The 0.025 SOL sizing, fee reserve and $10/$30 limits remain. In particular, two-hop SDK support does not grant signer permission; production isolated signer is unchanged and no funds have been requested.

## 2026-11-02 first-hop confirmed by the official SDK
- One-shot public-chain SDK probe GitHub Actions `41505159466` **SUCCEEDED**. Its onchain canonical PumpSwap pool `8zBr6K8wxVy8SmkEkYNtZWSpfwnQYWE7S1ATSMa7D1WY` has base mint `qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump` and quote `So11111111111111111111111111111111111111112` (WSOL), verified with one account RPC read and no secrets.
- Second hop already decoded from official PumpSwap state: target pool `JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8` base `D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump`, quote `qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump`.
- Therefore exact documented continuous route is WSOL -> qhbbj...pump -> D4An...pump, **both PumpSwap hops**. This corrects the original wrong one-pool assumptions. Official Pump SDK `multiHopSwapInstructions` is the path forward, with independently verified final min-output, account resolutions, fee ceiling and simulation. Not yet built/simulated/signed.
- All test work remains in isolated PR #279. The official SDK installed in ephemeral CI only, no production dependency pinned, no live signer change or funding approval.

Two-hop SDK build-only run `41505520691` failed before network reads; bounded stage/error-category logging added, still no quoting, simulation, signature or broadcast. No production change.

## 2026-11-02 official two-hop builder SUCCESS, BUILD ONLY
- Isolated CI run `41506082421` under **Node 24** successfully loaded the official `@pump-fun/pump-sdk@4.3.1` root module (Node 22 import threw SyntaxError), read and verified the two canonical public PumpSwap pools (two RPC requests) and constructed a **25,000,000-lamport two-hop unsigned v0 transaction**: 7 instructions, serialized size 1080 bytes, only known program IDs, exactly one unsigned payer signature slot, no ALT. No signer, RPC simulation, or broadcast.
- Test used placeholder `minAmountOut=1` on purpose to test instruction *structure only*; this is **not an acceptable execution quote** and MUST never reach an actual wallet signer. `quotedMinOutputVerified=false`, `slippageProtected=false`, `simulationAttempted=false`, `executable=false` in log. Neither transaction bytes nor keys were logged or persisted by the probe.
- For a genuine signing candidate, first obtain a fresh, independent two-hop fee/reserve quote with a defensible `minAmountOut` and 0.025 SOL principal+$10 all-in cap, validate all accounts and instructions, then simulate the exact unsigned bytes with actual funded account state, and only afterward use nonce-locked signed-and-discarded proof in isolated signer. An unfunded wallet cannot demonstrate a funded BUY simulation.
- SDK installed only inside the one-shot GitHub Actions job; **not** committed to the production package lock or wired to the Railway service. Do not promote build-only fixture into live code, fund wallet or enable auto-buy.

## 2026-11-02 real fee-aware two-hop quote and unsigned simulation evidence
- Official SDK read-only GitHub run [41507294334](https://github.com/investlens/solana_alert/actions/runs/41507294334) read both real canonical PumpSwap pools and fee config, and calculated a fee-aware exact-input **25,000,000 lamport** quote: estimated raw output **61,118,584,256**, conservative quoted min-out **55,006,725,830** (10% slippage).
- The matching unsigned transaction was built: **6 instructions**, **1,038 bytes**; parsed SystemProgram transfer amount **25,000,000 lamports**. This DOES NOT establish max wallet debit including all network fees, ATA rent or CPI costs; `additionalFeesFullyVerified=false`.
- One bounded Solana `simulateTransaction` call was attempted with `sigVerify=false` and no private key. It **FAILED** (`unitsConsumed=0`); the unfunded signer is plausible but not independently proven as the sole cause. No signing, raw transaction broadcast, or spending. `simulationPassed=false` and `signingApproved=false`.
- Historical target token remains ineligible for live trading based on previously observed >$100K capitalization. No funding green light from a quote/simulation of this token.
- Added pure, fail-closed `officialPumpTwoHopQuoteGate.ts` to enforce trusted fresh pool/fee/mint/manual-exit attestations, exact 0.025 SOL, bounded slippage, conservative rounded integer min-output, and $10 all-in budget; tests added. It is preview-only and NOT connected to production signing.
- Fixed draft reservation SQL so **only 25m lamports** can be admitted in phase 1 and the verified USD principal is stored (not hard-coded $10). PGlite test fixtures exercise duplicate tokens, two open slots, $30 lifetime cap and one-shot unknown submission; review-only and unapplied in production.
- Remaining: independent SOL/USD and fee/rent ceiling; fresh eligible caller mint and market cap; real signed-but-discarded transaction under trusted durable nonce/reservation; successfully simulated exact unsigned BUY with funded wallet; Phantom sell path validation; explicit separate owner authorization. No production service or DB changes.
