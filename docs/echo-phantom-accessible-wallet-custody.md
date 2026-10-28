# AlphaOS Echo — dedicated Phantom-accessible custody decision (2026-10-28)

**Status: design only; no wallet, key, signer, funding, deployment, or live trading.**

## User-selected custody
The admin selected a **new, dedicated Phantom-accessible Solana account** for personal oversight and manual SELL. Do not reuse the main Phantom wallet or its seed phrase.

**Critical limitation:** Phantom browser/mobile wallet cannot provide unattended signing for a server-side bot. A public wallet address or a Phantom connection alone does not enable automatic buying. Unattended automated buys require the same dedicated account's signing secret to be available to an independently secured signer. That means the key is exportable or otherwise recoverable and the bot has effective spending authority. This is materially less secure than a non-exportable key and cannot be described as unhackable.

## Key provisioning and custody safeguards
1. Admin creates a **new dedicated Solana wallet/account** in a trusted environment and verifies its public address. Never use the main wallet's recovery phrase or a derived account from the main wallet's seed for the bot. A separate account under the same seed does NOT provide seed isolation.
2. The user retains offline recovery material. Do not transmit a secret phrase, private key, JSON keypair, or QR code via ChatGPT, Telegram, GitHub, CI, support tickets, or logs.
3. If and only if separately approved later, a **securely isolated signing service** may receive this dedicated wallet's signing capability through a reviewed secret-provisioning process, with encryption at rest, tightly scoped service identity, no export APIs, audit trails, restricted network access, and spend controls. Avoid a raw plaintext `PRIVATE_KEY` environment variable in the alert bot.
4. Importing the *same dedicated wallet* into Phantom permits direct manual SELL and withdrawal from Phantom. Because the same key is also accessible to a future automated signer, compromise of either environment may expose funds. Strong Phantom device security, phishing-resistant authentication where supported, and small wallet balance are required.
5. Do not connect the main Phantom wallet to a signer. Do not store any key in the bot's existing Railway alert service.
6. The bot's `/autotrader` Telegram interface is read-only/control-only; it must never accept key material or arbitrary signing payloads.
7. Funding is prohibited until a test demonstrates that the admin can manually transfer and sell from this *specific* wallet and the backend cannot trade while disabled. Verify Solana mainnet address, token mint, and network before every transfer.

## Operational controls
- Only authenticated admin sender ID **and** private chat ID may access the dashboard; sensitive actions require separate admin confirmation and replay-resistant request IDs.
- The automated signer is **not** implemented or authorized in the current branch. All signer checks deny requests.
- Default STOP=true; automatic BUY OFF until separate explicit approval; automatic SELL permanently OFF for pilot.
- Max 0.1 SOL per BUY, 3% slippage, 2 open positions, 0.15 SOL daily loss breaker; allow only Slingoor and Chairman verified BUY events.
- Fail closed on missing market data, signer status, DB atomic reservation, stale quotes, RPC catch-up, or transaction reconciliation.
- One BUY per wallet+mint for the pilot, including across restarts and retries.
- Phantom manual SELL is initiated and signed by the user in Phantom, **not by a Telegram button**. Telegram may offer a verified chart/position link, but must not claim it can submit a Phantom sale.
- Reconcile externally initiated Phantom sales using verified on-chain transaction and token balance changes before reopening position capacity.

## Acceptance before funding
- Verify dedicated wallet independence from main seed and ability to export/import only through trusted wallet UI.
- Demonstrate a manual SELL and withdrawal on a controlled test asset with this wallet.
- Demonstrate that disabling the executor, restarting the bot, or losing the DB/RPC prevents new buys.
- Independent security review of signer isolation and key-handling procedures; complete tests and CI.
- Explicit admin approval for deployment and **separate** explicit approval for live execution.

No secret provisioning or wallet creation is requested at this stage.
