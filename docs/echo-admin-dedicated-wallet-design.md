# Echo admin-only dedicated execution wallet — design only (NOT ACTIVE)

## Immutable activation boundary
- This branch must never create, sign, broadcast, or deploy a live transaction.
- Existing production `src/core/adminTrading.ts` execution disable stays unchanged.
- Explicit separate user approval is required after audited implementation, passing tests, funding review, and deployment review.
- Only Slingoor and Chairman verified BUY events qualify. Auto SELL is forbidden.
- Trading signer must not be implemented using the user's main Phantom seed or private key.

## Custody and funding
1. Create a NEW dedicated, low-balance Solana execution key using a vetted key-management service/HSM with non-exportable keys, or a separately approved hardened signer. Never generate or store a secret in Telegram, repository, logs, or a chat.
2. Provide the *public* execution address to the admin over an authenticated channel. Require the admin to compare the displayed address against the signer identity before sending funds.
3. The user transfers a small SOL balance from Phantom to this dedicated execution address on Solana mainnet, initially only after a successful manual dry run. Funding is separate from authorizing live trading.
4. Phantom monitors the address. To sell manually, the signer cannot simply be assumed to be controlled by Phantom. Choose an approved manual-signing route: (a) dedicated secure signer exposes an admin-authenticated manual SELL request requiring explicit confirmation, or (b) user controls an independently provisioned exportable *dedicated* wallet imported into Phantom, with materially different custody risks. Never claim Phantom can sell funds held by a non-exportable HSM wallet.
5. For a non-exportable signer, withdrawal/manual SELL require authenticated, separately authorized signer transactions. Build this workflow before accepting real funds; prove an exit on a controlled test wallet.
6. Do not send funds until the operator has demonstrated ownership verification, withdrawal, manual SELL, and emergency stop.

## Execution isolation
- Separate executor worker/queue from the existing alert-only pipeline; Telegram delivery never blocks order handling.
- Signer accepts only narrowly scoped requests from an authenticated executor identity. Enforce spend/fee budgets and allowed Solana program IDs where technically feasible; never accept arbitrary unsigned transaction blobs from Telegram.
- Separate role and credentials for admin control, executor, read-only telemetry, and reconciliation.
- No private key exposure in environment dumps, stack traces, application logs, or GitHub Actions.
- No unrestricted remote signing endpoint; rate-limit, authenticate, audit and alert on every signing request.
- Restrict deployment to approved image digest and approved code revision; fail closed on config drift.

## Pilot risk parameters
- Slingoor: `5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij`.
- Chairman: `Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6`.
- Stake <= 0.1 SOL per BUY; slippage <= 300 bps; maximum two open positions.
- Daily realized + conservatively marked unrealized loss breaker 0.15 SOL; mark freshness required. Stop new BUYs on stale prices, unknown loss, or disconnected reconciliation.
- No automatic SELL. One purchase per (execution-wallet, token-mint) ever without explicit manual ledger reset and review.
- Additional required limits before approval: daily gross spend, priority fee cap, max quote age, max observed caller-to-entry price movement, minimum liquidity, minimum SOL reserve, and transaction age cutoff.
- Every check must occur at submission time, not just at detection time.

## Durable transaction state machine
1. Decode successful verified BUY; reject token transfers, SELLs, old or ambiguous events.
2. Fetch executable quote, validate mint, route, sellability, token-program and pool safety; fail closed on unavailable data.
3. Atomically reserve `(execution_wallet,mint)` with a unique DB constraint and compare-and-set state. Serialize budget/position claims in the same transaction.
4. Build and validate bounded transaction. Require signer policy approval and sign exactly once.
5. Persist encrypted signed transaction and its signature/expiry *before* broadcast; never persist keys.
6. Submit transaction; on timeout rebroadcast identical signed bytes only after signature-status check. Never create a second signature automatically.
7. Reconcile transaction confirmation, actual token balance, fees, and SOL delta. Unknown states block further attempts.
8. Update positions and P&L with verified chain evidence. Manual SELL is a separate admin-confirmed transaction with its own audit trail.
9. After every crash/restart, replay unresolved intents before accepting any new BUY.
10. All controls require persistent admin identity checks and a kill switch that prevents new orders even when Telegram is down.

## Acceptance tests required before funding/activation
- Simulated signer denies unauthorized callers, unauthorized instructions, overspend, and altered transaction after policy validation.
- 5 duplicate caller BUYs, parallel workers, crash between signature and broadcast, RPC 429, timeout after acceptance, stale blockhash, and unknown confirmation do not produce duplicate purchases.
- Simulated adverse slippage, no sell route, stale prices, low balance, unavailable RPC, missing ledger, and daily loss breach all fail closed.
- Position cap remains correct with concurrent submissions and manually sold positions.
- Manual sell and withdrawal are demonstrated end to end with separate admin confirmation; no automatic sell path exists.
- Full RPC/WebSocket catch-up, alerts, and ledger reconciliation must be independently validated.
- Typecheck, full tests, staged integration, and security review must pass before requesting explicit approval.

## Current status
Architecture document only. `src/echo/adminPilotConfig.ts` is a disabled shadow policy, not an executor, signer, wallet, or funded account. No wallet address exists or is presented here. No deployment or trading activation.
