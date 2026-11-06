# Echo isolated signer — staged proof-only setup (2026-11-02)

**State:** Railway service `alphaos-echo-isolated-signer` was created as a **staged empty service**, not deployed. It has no GitHub source, key, outbound route, public domain, or running process. This does not prove real wallet custody.

## Staged configuration

- ECHO_SIGNER_MODE=PROOF_ONLY
- ECHO_SIGNER_BROADCAST_ENABLED=false
- ECHO_SIGNER_REQUESTS_ENABLED=false
- ECHO_SIGNER_EXTERNAL_NETWORK_ENABLED=false
- ECHO_SIGNER_EXPECTED_WALLET=8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ

Do **not** accept/deploy the staged patch as a functioning signer yet. An empty service cannot sign a challenge or simulate a BUY. If deployed prematurely, it may incur charges without providing functionality. Keep the main AlphaOS bot untouched.

## Required separation

1. The running `solana-alert-bot` owns an `ADMIN_TRADING_PRIVATE_KEY` variable **name**, but its value is redacted to this connector. It is unknown whether that key belongs to the pinned Echo wallet. Do **not** move or copy it into the new service. The local-only comparison script `scripts/echoCheckLegacyWalletBinding.ts` is a diagnostic to be run by an authorized operator in a trusted runtime, not an API for transferring key material. It is not running or deployed.
2. Select a dedicated low-balance wallet whose account is available to the owner for manual SELL. Prefer a protected, access-controlled Ed25519 signer with non-exportable key storage. Check the key's actual public address before making the service operational. Never put private keys in GitHub, ChatGPT, Telegram or general application logs.
3. Only inside the isolated signer, use the `EchoCustodyProofProvider` interface to sign a fresh **off-chain** `AlphaOS-Echo/wallet-ownership/v1` challenge. Verify the exact pinned public wallet, audience, nonce, timestamp and Ed25519 signature with `verifyEchoConfiguredWalletCustody`. This proves only custody; trading remains hard-off.
4. For signed-but-not-broadcast BUY testing, pass an independently audited and simulated **actual v0 BUY transaction** through `echoReadOnlySignerAdmission`, which verifies authorized coordinator signature, one-time nonce and DB reservation against exact unsigned bytes. Only after that admission, `dryRunEchoActualWalletBuyNoBroadcast` can invoke the isolated provider's message-signing method. The dry-run function verifies the Ed25519 signature locally, wipes its temporary signature buffer best-effort, returns no signed transaction or signature, and never submits a transaction.
5. Real execution is not implemented/approved; passing this test is **not** authorization to trade. For production, independently verify all Solana programs, program upgrade authority, account lookup tables, SPL token destinations, rent/fees, price/mcap and transaction economics; enforce atomic all-in ledger and one-shot claim in actual Postgres; verify exact signature/digest; secure receipt/recovery; obtain separate explicit activation approval.

## Tests (synthetic wallet only)

`npx tsx --test tests/echoOfflineSignedBuyDryRun.test.ts tests/echoConfiguredCustodyProof.test.ts tests/echoOneShotBuyHandoff.test.ts`

The tests generate a disposable wallet and prove that the signing callback is **not** called when the signer identity is wrong, crypto failures are rejected, the signature is not exposed by the function result, and broadcast remains disabled. They do **not** prove control of the real Echo wallet.

## Remaining hands-on acceptance

- [ ] Verify whether the legacy key's public address matches without disclosing its secret.
- [ ] Provision dedicated signing custody through a reviewed secure provider with owner's consent.
- [ ] Attach audited signer source to the staged Railway service and obtain explicit authorization before deploying any additional service/cost.
- [ ] Perform real fresh ownership challenge and log only its result (no challenge signature or key material in alerts).
- [ ] Build and inspect actual unsigned BUY route and simulation from a supported provider.
- [ ] Perform signed BUY locally inside isolated signer **without broadcasting**, recording only pass/fail and transaction message digest.
- [ ] Verify production DB migrations and cross-worker contention tests; only then seek authorization for one small controlled mainnet BUY and manual Phantom exit.

## Staged Railway service created in this session

- Project: existing Echo Railway project.
- Service: `alphaos-echo-isolated-signer` (ID `17eeb56f-7530-4981-ad7f-26d80a5c4f37`).
- Service state: `staged-create`, patch `dcff792d-8efc-4f9c-af08-87edbe5379e3`.
- No source, deployment, key, domain or live processes. **Do not accept/deploy this empty service.**
- Staged variables: `ECHO_SIGNER_MODE=PROOF_ONLY`, `ECHO_SIGNER_BROADCAST_ENABLED=false`, `ECHO_SIGNER_REQUESTS_ENABLED=false`, `ECHO_SIGNER_EXTERNAL_NETWORK_ENABLED=false`, pinned wallet public address.

When an authorized operator independently provisions the **dedicated, low-balance** wallet inside this service through Railway's secure **sealed** variable mechanism, use only the new variable name `ECHO_ISOLATED_SIGNER_SECRET_B58`. Never reuse or reference `ADMIN_TRADING_PRIVATE_KEY` from the main bot, and never send the key to a tool or chat. The CLI `npx tsx scripts/echoIsolatedSignerProveOnce.ts` must run **inside the isolated service** after its reviewed source has been installed. It performs a fresh off-chain signature proof and prints only `ECHO_ISOLATED_CUSTODY=VERIFIED|MISMATCH|UNPROVISIONED;TRADING=OFF`.

This proof-only adapter deliberately **refuses to sign arbitrary or transaction-like messages**. For a real signed-but-not-broadcast BUY, a separate transaction-signing custody provider must be reviewed against transaction program/accounts/fees and trusted admission before enabling the `offlineSignedBuyDryRun.ts` flow. No current deployment can perform that test yet.
