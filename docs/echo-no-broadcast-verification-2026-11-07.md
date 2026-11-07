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
