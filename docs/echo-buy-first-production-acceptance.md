# Echo auto-BUY launch checklist — REVIEW ONLY

This document does not authorize deployment, a database migration, a fund transfer or a trade.

## Evidence inspected on 2026-11-02

The owner confirms app access to the intended dedicated Phantom wallet. This is not cryptographic proof that an unattended signer controls it. Railway's echo-admin service reports shadow trading only: no quote or reservation execution stages connected. The legacy main solana-alert-bot has an ADMIN_TRADING_PRIVATE_KEY variable **name**, but its wallet address is unknown. Do not fetch, export, duplicate or reuse the legacy key; keep AlphaOS stable.

Supabase contains a base echo_live_buy_intents table with zero rows, but the full pilot atomic and all-in budget migrations and signer nonce migration have not been applied. CI tests do not prove runtime custody or actual swap functionality.

## Required go-live gates

1. **Custody.** Provision an isolated Ed25519 Solana signer or trusted key-management system with access only to the low-balance dedicated wallet. Demonstrate a fresh signed wallet ownership challenge. Ensure the same exact wallet is accessible to the human through Phantom. Never put private keys in chat, GitHub, logs, or the Telegram bot.
2. **Trusted sources.** Verify signer-owned Slingoor/Chairman BUY receipts, not token transfers. Require a fresh source-backed market capitalization strictly below $100K. Obtain an independently verified caller entry price and a real executable BUY quote with no more than 50% premium.
3. **BUY builder.** Build a real Pump.fun/PumpSwap or reviewed compatible route, with maximum 1000 bps slippage. Independently check all transaction instructions and programs, account lookup tables, correct fee payer, wallet-owned token destination, SOL amount, all fees, and simulation. Unknown upgradeable programs are not authorized.
4. **Atomic funds.** Independently review the ordered SQL migrations, back up the real database and apply only with operational approval. Test database contention from two clients, lifetime wallet/mint deduplication, maximum two pending/open positions, $10 maximum all-in BUY and $30 conservative lifetime budget. Persist nonce replay protection.
5. **Signer-side proof.** An isolated signer must independently read the persisted reservation and fresh chain wallet balance and price before signing. Pin the coordinator public key. Atomically consume each request nonce. Bind signature to the exact approved serialized Solana message.
6. **Single broadcast.** Persist the original signed signature and transaction fingerprint before one RPC submission attempt. Unknown or timeout outcomes hold the slot indefinitely until authoritative chain reconciliation. Never resubmit a failed or uncertain BUY.
7. **Manual exit.** The owner uses Phantom to SELL from exactly the funded signer wallet. A partially sold token still occupies a slot. An externally observed finalized full SELL and zero held token balance are required before the database can mark the position closed; chain watcher and close mutation are not yet implemented.
8. **Real acceptance.** Prove signer custody with the real key, then successfully sign without broadcasting a reviewed transaction. Verify complete simulations and database restart recovery. Make one deliberately small confirmed mainnet BUY only after explicit operational approval. Confirm token and SOL deltas and manual exit before unattended automatic BUY.

## Present status

The GitHub branch has read-only BUY preview, capital proof, all-in reservation adapter, durable journal, cryptographic signed-message verification, one-shot handoff, wallet-app external exit verifier, and tests. It does not yet include an operating isolated signer or actual automatic BUY broadcast. Existing deployed Echo and AlphaOS services remain unchanged.

## Failure conditions

Untrusted signer, mismatched wallet, missing or stale market cap, unknown instructions, unverified destination, insufficient SOL for exit fees, two occupied slots, previously purchased mint, lost DB connectivity, uncertain submission, or expired quote all fail closed. Speed is a target, not an override.
