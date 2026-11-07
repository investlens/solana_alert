# Echo $5 all-in no-broadcast verification — November 7, 2026

This file records a **single explicit read-only GitHub Actions trigger** for the `echo-isolated-signer-real-rpc` diagnostic. The commit carrying it deliberately contains `[echo-isolated-test]`; normal subsequent commits do not trigger the job.

## Scope
- Dedicated wallet public address: `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ`.
- The job builds a pinned official PumpSwap SDK unsigned scenario on a disposable GitHub runner; any real-RPC simulation is only provisional.
- The runner does **not** load the sealed Railway wallet key; its contract explicitly prohibits signing, broadcasting and trading. The running Railway signer is a separate custody-proof-only script.
- The currently configured scenario may be hard-coded to historical example mints and may fail against current pools; such failure means no trading approval.
- A successful receipt, pool verification or read-only simulation cannot prove independently bounded total CPI/rent, exact $5 all-in pricing, Phantom manual SELL execution or unattended signer readiness.

## Acceptance evidence required after run
1. Official SDK installed at precisely pinned version.
2. Source pools, executable instruction and wallet exact unsigned hash verified from fresh RPC.
3. Real wallet funded-state simulation successful, with full network/priority/ATA/rent and CPI budget, plus reliable SOL/USD. A missing funded wallet **blocks this item**.
4. Full Phantom SELL receipt/quote and independently reserved pre-sale SOL.
5. Authenticated signer signed-but-discarded test in the *sealed-key Railway boundary*, owner switch OFF/ON tested with durable DB/nonce; no actual live send.
6. Separate owner approval before deploying any executable broadcaster or submitting one $5 all-in live purchase.

Do not fund, migrate production database, expose secrets, deploy or change the live Telegram alert service based solely on this diagnostic.

## November 7 — diagnostic failure investigation (second isolated probe)
- The first signer real-RPC job denied signing with `OFFICIAL_REBUILT_MESSAGE_DIFFERS_FROM_SIGNER_REQUEST`. This confirms SHA matches the exported unsigned bytes, but rebuilding instructions from independently fetched SDK pool state yielded a different complete v0 transaction.
- We **did not bypass** bytewise verification or turn on signing. Added distinct failure classifications for rebuilt account list, instruction count and instruction data so future logs can identify whether independently reread state or SDK-generated accounts drifted. Added negative tests for altered account lists and instruction bytes.
- This commit explicitly requests one more safe no-key/no-broadcast signer RPC diagnostic. A failed job is evidence of remaining work, not a release denial to override.

## November 7 — #1055 exact account key mismatch
- User confirmed green CI for the two preceding deterministic structural-guard changes, and failed `echo-isolated-signer-real-rpc` #1055: `OFFICIAL_REBUILD_ACCOUNT_KEYS_DIFFERED`.
- Separate causes now distinguished without exposing accounts/transaction bytes: (1) official SDK mutates account keys using identical snapshot and inputs across two calls; (2) independent later snapshot changes the account-key set, count, or ordering. Both are still fail-closed, no release.
- Added same-snapshot deterministic SDK instruction comparison in `signerOwnedOfficialPumpQuote.ts` and regressions, and made existing changed-key test stable.
- This last marked commit triggers exactly one read-only public mainnet diagnostic on a no-secret GitHub runner. **Not a Railway signer test or trading approval.**

## November 7 — confirmed nondeterministic official SDK builder
- Latest one-shot signer RPC diagnostic failed closed with `OFFICIAL_SDK_SAME_SNAPSHOT_NONDETERMINISTIC_INSTRUCTIONS`; caller confirmed ordinary regression #1057 green, isolated diagnostic #1058 blocked.
- This proves the SDK's repeated instruction constructor does **not** output byte-identical instructions with fixed hops, amount and fee config. Whole-message independent recreation is not a sufficient authentication mechanism for these SDK builds.
- Added instruction-family-level, no-public-account-logging diagnostic to identify whether PumpSwap instruction, System SOL operations or ATA/token setup changes, including address-vs-privilege-vs-data classification. Negative unit tests cover stochastic PumpSwap and ATA account addresses. Mismatch remains blocking. A follow-up architecture must audit the **original exact compiled transaction**, its setup instructions and signer-owned independently fetched core swap/route evidence; comparing a freshly created incidental setup account cannot substitute for that.
- This marked commit triggers one read-only, no-key diagnostic; `[echo-isolated-test]` does not enable signing or broadcasting.

## November 7 — confirmed PumpSwap swap account drift: fixed recipient-selection source
- Observed from user-supplied real-RPC job: `OFFICIAL_POOL_OR_QUOTE_SDK_SNAPSHOT_PUMPSWAP_ACCOUNT_ADDRESS_DRIFT`.
- Official SDK guidance states the buyback fee recipient is chosen randomly by default from an allowed on-chain global-config list. The recipient is inside the PumpSwap instruction accounts and thus changes compiled unsigned hashes even with identical input route, fees and pool state.
- **Fix:** `signerOwnedOfficialPumpQuote.ts` requires the signer-read `globalConfig.buybackFeeRecipients` array, validates nonempty unique public keys, selects its first entry, and explicitly passes `buybackFeeRecipient` to both SDK calls. `echoOfficialFiveUsdScenarioQuote.ts` uses the very same on-chain config recipient for both the first provisional quote and dynamically resized exact $5 scenario transaction. No hardcoded recipient, no arbitrary client choice.
- Added CI cases requiring explicit pinned SDK recipient and rejecting absent authoritative recipient list. The exact unmodified serialized transaction SHA, original transaction account checks and no-broadcast rules remain mandatory. No production bot or signer modified.
- This tagged commit requests a fresh ephemeral GitHub Actions **read-only** official SDK scenario; passing would establish only stable quote reconstruction, not real funded-wallet simulation, CPI attestation, manual Phantom exit or authorized real trading.

## November 7 — post-funding read-only real RPC verification
- Owner reports dedicated Phantom wallet funded at 2026-11-07 08:08 UTC; **amount, confirmation and actual balance not independently established in this note**.
- Prior diagnostic `EXACT_WALLET_SIMULATION_UNFUNDED_PAYER_CANNOT_SIMULATE_BUY` followed successful exact unsigned transaction hash and independently rebuilt official two-hop PumpSwap quote.
- This tagged push requests a **read-only** CI rerun against fresh confirmed Solana RPC wallet state, with signing and broadcasting still explicitly disabled. This is a repeat of the actual-wallet scenario, NOT a live purchase or production rollout.
- A passing provisional simulation will NOT certify CPI rent/priority-fee completeness, Phantom manual SELL, or signer signing authorization. The system stays trading OFF.

## November 7 — funded-wallet CPI and compute evidence pass
- Operator reports 0.1 SOL funded; current SOL balance, simulation outcome and token receipt **not independently verified here**. Neither funding nor simulation authorizes any buy.
- Wired `probeSignerOwnedPumpRpc.onValidatedSimulation` to the existing strict `reconcileEchoSignerPumpCpiLedger` in the actual official-SDK one-shot diagnostic. A transaction now needs its exact SHA, independently checked quote, successful actual-wallet RPC simulation **and** decodable, reconciled payer SOL System/inner CPI ledger before getting PROVISIONAL status.
- CI's sanitized result on success shows observed confirmed wallet balance in lamports, **conservative SOL payer debit including RPC fee**, CPI instruction count and RPC compute units consumed (or null). None is a token delivery, SOL/USD oracle freshness or manual SELL proof.
- Mismatched payer balance, unexpected inner CPI operations, absent trace or stale slot fails closed. Full token effects and Phantom manual SELL are still false. No new signing or send paths.
- One-shot `[echo-isolated-test]` push requests a new ephemeral runner on real public RPC; test uses existing **$5 scenario**, not a live $2.50 pilot. Any future pilot amount must be enforced in all stages before live approval.

## November 7 — real funded simulation CPI encoding compatibility fix
- Run #1071 diagnostic returned `EXACT_WALLET_SIMULATION_MALFORMED_SIGNER_CPI_INSTRUCTION` after `exactMessageHashVerified=true` and `poolAndQuoteVerified=true`.
- The Solana RPC JSON structures specification documents that **simulation returns CPI instructions as JSON Parsed by default**, but the payer-side reconciliation requires compiled instruction indexes. This is a **response encoding mismatch**, not proof of an invalid swap or approval to trade.
- Explicitly request `innerInstructionsEncoding:'json'` together with `innerInstructions:true` in signer-owned `simulateTransaction`; reject any parsed fallback with `RPC_RETURNED_PARSED_CPI_INSTEAD_OF_COMPILED`. No account re-indexing or unchecked transformation, and every CPI index/fee still requires validation. Added regression coverage for the requested encoding and for parsed fallback rejection.
- Run the fresh **read-only actual-wallet** CI probe via `[echo-isolated-test]`. Never sign, broadcast, or deploy. Payer lamport CPI ledger, token effects and Phantom SELL still require evidence.

## November 7 — direct Solana indexed-CPI simulation wire request
- Latest user-provided funded wallet diagnostic: `EXACT_WALLET_SIMULATION_RPC_RETURNED_PARSED_CPI_INSTEAD_OF_COMPILED` with `exactMessageHashVerified=true` and `poolAndQuoteVerified=true`.
- Root-cause boundary: `@solana/web3.js@^1.98.4` `Connection.simulateTransaction` convenience transport is not reliably forwarding the supported `innerInstructionsEncoding:'json'` request option; the response remains in default `jsonParsed` CPI format.
- Added separate **single-purpose, read-only** adapter that uses the *same previously pinned Connection* and its `_rpcRequest('simulateTransaction', ...)` transport; explicitly transmits `encoding:'base64'`, `innerInstructions:true`, `innerInstructionsEncoding:'json'`, `sigVerify:false`, `replaceRecentBlockhash:false`, confirmed commitment, validated minContextSlot and **only the exact wallet payer account snapshot**. Never signs, modifies/replaces blockhashes, or broadcasts.
- Validates response envelope and then relies on unchanged strict compiled CPI index validation and payer-only ledger accounting; any parsed CPI fallback fails closed. Dedicated regression checks assert exact base64 bytes, every required RPC option and rejection of unsafe config.
- The tagged push below requests one ephemeral SDK mainnet no-broadcast test; production Railway remains unchanged. Passing this test will remain **provisional**, not authorization for $2.50 pilot.

## November 7 — provider returns jsonParsed CPI despite indexed request; safe mixed-format normalization
- New funded-wallet evidence: `EXACT_WALLET_SIMULATION_RPC_RETURNED_PARSED_CPI_INSTEAD_OF_COMPILED` even after using pinned low-level `_rpcRequest` with `innerInstructionsEncoding:'json'`. Exact hash and signer-owned official pool/quote both passed. This confirms server/provider response shape incompatibility and is NOT authorization for trading.
- Added `normalizeSignerSimulationCpi` for **compiled** CPI numeric indexes, **partially decoded** CPI whose base58 account addresses are matched against exact original static transaction keys, and **fully parsed System transfer/createAccount** CPI rebuilt strictly from their typed source, destination, lamports, owner and space. No unknown System payer operations admitted.
- For JSON-parsed SPL Token, Token-2022, Associated Token Account and PumpSwap CPI, preserve verified program identity with an explicit `opaqueParsedNonSystem` marker, NOT fabricated instruction bytes. The payer-only SOL reconciliation checks balance delta against all proven System debits and network fee. Unknown programs or mismatched balance remain blocking. Token effects and Phantom SELL remain `false`.
- This is a **payer SOL lamport proof only**, conditional on RPC snapshot correctness. Binary token instruction authorization and full end-to-end all-in costs still require independent evidence. Added adversarial regression tests including unknown System operation, foreign account and forged payer marker.
- This one-shot `[echo-isolated-test]` request uses GitHub public RPC with no private key; the operational 0.1 SOL wallet has no auto-trading access through it. No production change or live trade.

## November 7 — payer SOL delta differs from decoded CPI debits
- User supplied new post-funding run: `PAYER_CPI_LEDGER_UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE`. Exact hash and signer-read official pool/quote both verified. The synthetic signer probe **still cannot certify** complete all-in $5 debit.
- The payer-only ledger now reports a **sanitized, bounded**, fail-closed mismatch diagnostic containing observed payer lamport delta, decoded outbound System debits, decoded inbound System credits, network fee estimate, and the two exact differences. No raw transaction bytes, private keys, account address list, logs or key material are logged.
- Solana SPL Token `CloseAccount` can refund a token account's remaining rent / native SOL **directly** without a System Program transfer CPI; this is a candidate explanation, not a confirmed refund. No speculative rent credits are inserted into successful accounting. Only explicitly validated System credits from the exact message may be counted, and full Phantom SELL/token effects remain unverified.
- Negative regression verifies unexplained balance discrepancy stays BLOCKED with an exact number. Separate regression checks explicitly verified System payer credits, still with trading OFF.
- A fresh `[echo-isolated-test]` run should expose the missing lamports to identify the next real root-cause step. No automatic BUY, signing, broadcasting, extra funding or production deployment.

## November 7 — exact discrepancy 1,483,440 lamports, identify payer-directed token close
- Real funded-wallet diagnostic reports observed payer delta **45,810,216 lamports**, decoded outbound System payer debits **47,293,656 lamports**, zero inbound System credits and independently quoted network fee **5,000 lamports**, with 21 instructions reviewed. Difference between payer delta and outgoing transfers: **-1,483,440 lamports**. The precise source is **not yet independently proven**; a token CloseAccount/wrapped SOL rent refund is only a candidate.
- Added strict classified observation in parsed CPI normalizer: a SPL Token or Token-2022 `closeAccount` explicitly targeting the authenticated fee payer, whose closing source exists in the *exact unsigned transaction account keys*. Pass only count and exact-message source key index into the ledger. Sum existing payer System transfers to those candidate sources solely for explanation, never as verified incoming credit.
- Mismatched balance remains `BLOCKED` with `signingAllowed:false`, `broadcastAllowed:false`. Diagnostics include count of payer-directed closes and funded-source lamports, not source addresses or raw payloads. Additional unit tests cover candidate close and unrelated destination. This change is observational and does not enable any automatic trade.
- Exact independent proof of a token-close rent refund will require independently observed close-account pre-lamports and post-state at the simulation bank or a full bounded lamport ledger, and a real Phantom SELL route before any live pilot.

## November 7 — observational token-close prestate check; no refund credit inferred
- From the latest owner-supplied mainnet simulation, `observedPayerDeltaLamports=45810216`, `outboundSystemDebitsLamports=47293656`, `networkFeeLamports=5000`, and `unexplainedAgainstDebitOnlyLamports=-1483440`. Full CPI ledger remains BLOCKED; no execution approval.
- New `observeTokenCloseSourcesReadOnly` checks at most eight independently identified, payer-directed token-account close sources, whose indexes must bind to the exact unsigned transaction keys. Uses confirmed `getMultipleAccountsInfoAndContext` with a minContextSlot equal to or newer than the verified simulation slot, checks SPL Token / Token-2022 ownership and account lamports, and returns only aggregate public balance and count. All reads are bounded and read-only.
- A later-slot account snapshot is NOT the simulation-bank prestate; the evidence explicitly returns `exactSimulationBankMatched:false`, `refundProven:false` and trading OFF. An absent account may be ephemeral; a present account can have changed state. The ledger remains blocked on any unexplained payer delta. No credit is inferred or accepted from candidate counts, rent assumptions or source account balances.
- A dedicated regression covers exact source indexes, slot floors, missing ephemeral accounts, unknown owners, and no trade authorization. The next tagged `[echo-isolated-test]` run requests this diagnostic in disposable CI; no production Railway configuration is modified.

## November 7 — zero parsed close candidates: audit binary and top-level token closes
- User supplied a second funded-wallet mismatch: observed payer delta `45,791,638`, outbound System debits `47,275,078`, network fee `5,000`, unknown balance difference `-1,483,440` lamports, 21 instructions reviewed. The gap is IDENTICAL despite different principal. Earlier `candidateTokenCloseRefundCount:0` only covered JSON-parsed inner token closures, not binary or top-level ones.
- Extended the payer ledger to observe exact unsigned transaction's **top-level SPL Token/Token-2022 CloseAccount opcode 9** as well as compiled binary **inner** CloseAccount CPI. Require byte opcode/length, exact indexed source/destination/authority accounts and destination equal to the trusted payer. Count only unique close sources and classify top-level vs inner. This is observation only; unknown refunds are **not** credited, and `PAYER_CPI_LEDGER_UNEXPLAINED_PAYER_LAMPORT_BALANCE_CHANGE` stays blocking.
- Regression tests cover both binary close families and assert no signing/broadcasting permission on an unexplained wallet delta.
- This `[echo-isolated-test]` read-only push requests fresh mainnet evidence; a confirmed CloseAccount still does not prove the refund amount without same-bank account-balance evidence. Continue live AUTO BUY OFF; no further funding or production deployment.

## November 7 — thorough funded-wallet safety audit (must remain NO LIVE BUY)
User's latest real-RPC no-broadcast evidence:
- Exact unsigned SHA and independent official SDK pool/quote passed.
- Actual fee payer observed balance change: `45,773,072` lamports; decoded System outgoing `47,256,512` lamports; separately estimated message fee `5,000` lamports.
- Observed difference `47,256,512 - 45,773,072 = 1,483,440` lamports. Adding fee yields `1,488,440` lamports, consistent with newer 165-byte SPL token-account rent **but still an unproven inference**.
- Exactly one top-level token CloseAccount targets the payer, zero inner closes. Its source is absent from later confirmed on-chain read; this is consistent with an ephemeral closed token account, NOT proof of the exact simulation-bank refund amount or prestate.
- New diagnostic requests signer-pinned RPC `getMinimumBalanceForRentExemption(165)`, classifies whether `observed difference + network fee` equals independently returned rent. Returns `exactBankRefundProven:false`, `canSign:false`, `canBroadcast:false` regardless of numeric match; the ledger remains blocked.
- Added negative test protecting the recorded 1,483,440-versus-1,488,440 arithmetic and blocking a guessed account refund.
- SELL unsigned SDK preview now pins recipient independently sourced from approved on-chain global config, preventing random recipient drift; new negative test blocks absent recipient config.
### Remaining release blockers
1. Obtain rigorous, same-simulation-bank ephemeral WSOL account lifecycle accounting: source created/funded, rent reserve, WSOL amount after swap, close destination and exact SOL returned, including network fee convention. Avoid accepting equality to current standalone rent as proof by itself.
2. Independently inspect the exact target token post-simulation account amount/mint and token fee effects; parsed SPL token CPI treated as opaque is not independently complete.
3. Replace scenario's unverified operator CPI allowance and non-live price assumptions with independently checked current SOL/USD and hard total **$2.50 all-in** buyer debit limit; current proof scenario is still $5, **not** the user-approved pilot size.
4. Verify genuine full-balance Phantom manual SELL path and reserved SOL even under worthless-token conditions. The current unsigned reverse-route shape is only preliminary.
5. Isolated signer signed-but-not-broadcast verification, DB atomic constraints and owner gate reviewed together; ensure caller policy and no retry. Main alert service on older Railway branch remains untouched. No live trading until independent user authorization after these gates.
This tagged `[echo-isolated-test]` requests one new keyless GitHub read-only RPC test and focused regression checks; it does NOT deploy to Railway, sign, broadcast or activate a trade.

## November 7 — same-bank post-simulation token close proof (no refund authorization)
- Latest real-RPC funded wallet result: `RENT_AND_NETWORK_FEE_MATCH`; payer balance decrease `45,773,072` lamports, outbound System transfers `47,256,512` lamports; fee `5,000` lamports; independently fetched standard token-account rent `1,488,440` lamports. A *single* top-level Token CloseAccount sends account lamports to the payer, but an after-the-fact RPC read returned a null source account, so same-bank state was absent.
- Changed exact unsigned transaction simulator (not the live signer) to inspect the verified payer **and** the single authenticated top-level SPL Token account that closes to that payer in one `simulateTransaction` request. The only added account must be an exact static account key referenced by the original transaction; reject a source with unexpected close authority, untrusted extra accounts, multiple close sources or a non-null source state in the same simulation result.
- The returned `sameSimulationTokenCloseConfirmed` means **the account was absent after that exact simulation**. It does NOT establish the account balance immediately before closing, the refund amount or token destination effects; full payer CPI ledger and real Phantom SELL remain independently blocked.
- New focused tests cover same-bank closed/null account, still-existing account, unauthorized close authority and non-broadcast guards. This tagged `[echo-isolated-test]` is a fresh ephemeral real-RPC check, **not** a Railway deployment or authorization to buy.

## November 7 — same-bank closed source returned non-null by simulateTransaction
- Latest isolated real-RPC check returned `EXACT_WALLET_SIMULATION_PAYER_TOKEN_CLOSE_SOURCE_NOT_ABSENT_AFTER_SIMULATION` after verified exact hash and pool/quote. **This is not evidence that CloseAccount failed**: the simulation RPC may return a zero-lamport System-owned, cleared account representation until runtime cleanup, instead of `null`. The strict old `null`-only check is insufficiently compatible.
- Validator now accepts only `null` OR a **zero-lamport, System-owned, non-executable account with exactly empty base64 data** at the same simulation slot. It still rejects any nonzero balance, untrusted owner, token data, invalid response shape, or multiple/unauthorized token close instructions.
- On rejection, prints only a bounded, sanitized `closeSourceDiagnostic` with state category, lamports, ownerIsSystem and byte length; no key material, account list, base64 data, addresses or RPC logs.
- Tests cover strict zero-cleared-accepted versus funded/uncleared-rejected. Whether latest public RPC response satisfies these checks is not yet confirmed.
- The CPI debit ledger remains **blocked** even when same-simulation closure is observed, pending independently established refund lamports; token-delivery and manual Phantom SELL remain unverified. No signing, broadcasting, or live deployment.

## November 7 — same-bank source closure confirmed; exact rent discrepancy classified separately
- User provided mainnet diagnostic following `ebb1ab76`: exact hash and independent quote passed; successful simulation with **sameSimulationTokenCloseConfirmed=true** and one top-level account closure to payer. Outbound System payer debit `47,194,715`, observed payer delta `45,711,275`, inferred difference `1,483,440`, network fee `5,000`, verified current RPC 165-byte rent `1,488,440` lamports. Later account read source absent. All runtime trading flags OFF.
- Do **not** declare the refund proven merely because the numbers match: the exact account's source funding and close-return lamports were not independently captured from same-bank pre-close state, and its token effects were not proven.
- Added a strictly **non-authorizing** `classifyEchoRentRefundPattern` separate from payer ledger: only the observed exact inequality, one unique top-level close, same-simulation closure, later RPC source absence and independently queried rent match receive `RENT_PATTERN_MATCHED_NOT_AUDITED`; the precise conservative no-refund payer debit upper bound (System outgoing + fee) is printed as a diagnostic. The classifier always returns `independentlyAuditedRefund:false`, `payerCpiLedgerReconciled:false`, `signingAllowed:false`, `broadcastAllowed:false`. The real ledger **still blocks** until exact refund evidence exists. Other cases receive `RENT_PATTERN_NOT_PROVEN`.
- Added tests for exact owner-supplied real lamport figures and adversarial altered fee, rent, transfer, source count and closure state. These tests do **not** approve signing or deployment.
- Unresolved release gates remain the **$2.50 all-in** sizing and independently sourced SOL/USD, SOL payer and token effects under exact blockhash, secure isolated signer dry-sign, atomic DB reservation/idempotency, Phantom SELL reserve, and live branch readiness. Production Railway untouched. Tagged `[echo-isolated-test]` push requests read-only CI only.

## November 7 — urgent $2.50 pilot scenario and conservative no-refund budget
- Corrected isolated real-RPC test to set an **explicit $2.50 all-in scenario** (`ECHO_SCENARIO_ALL_IN_CENTS=250`) instead of testing only $5. The separate historical $5 diagnostic now explicitly sets 500; no implicit fallback or silent enlargement of the pilot.
- SDK quote dynamically subtracts projected network fee, ATA allowance and explicit *unverified* CPI allowance from the selected cap. It exports the scenario's dollar cap and two-public-exchange upper SOL/USD quote alongside the exact immutable unsigned hash; signer diagnostic validates all supplied fields. This is diagnostic spot pricing only, not a verified signed trading oracle.
- Added independent `evaluateEchoPilotNoRefundBudget` to compare **all reconstructed outgoing System lamports plus network fee**, **without subtracting hypothetical rent refunds**, against the $2.50 cap using a conservative ceiling division. A provisional result cannot make CI green when budget evidence is missing or over cap; existing underlying diagnostic errors are preserved. No signed or broadcast instructions anywhere.
- Regression cases cover small $2.50 versus $5, rent-not-subtracted, duplicate fee accounting and invalid inputs. The full live signer still needs a trusted oracle and exact independent token/CPI accounting; even a passing budget diagnostic cannot approve signing.
- A new `[echo-isolated-test]` run is requested. Await GitHub's direct tests and mainnet read-only output. No wallet funding, Railway deployment or live trades authorized.
