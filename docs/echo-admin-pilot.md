# AlphaOS Echo — admin pilot

Implementation validation: TypeScript check and 1,058 repository tests pass,
including 11 Echo tests. Live provider delivery, HTTP deployment and Telegram
receipt remain unvalidated; do not describe this draft as an active pilot.

Isolated Helius enhanced-SWAP webhook receiver. It is not imported by the existing
bot or chain workers. No shared settings, migrations, pollers or trading code are
changed. No new dependencies. No transaction signing or live buys.

## Scope

Watch Cupsey, Thedetective, Croakie and Chairman using the public profile wallets
in `src/echo/signals.ts`. These are research candidates, not validated profitable
traders. Their other wallets and unsupported swap formats are outside coverage.

Only a wallet's own aggregate swap input/output can produce an alert. Native SOL,
wrapped SOL and USDC quote legs are supported. Transfers, gifts, token-to-token
swaps, ambiguous multiple legs, malformed data, failed transactions and events
older than 120 seconds are withheld. RPC independently checks confirmed/finalized
status. Receipt is not evidence of token safety, liquidity or an executable exit.

## Separate worker configuration

One replica only; persistent volume required for the dedup file. Start command:
`npx tsx scripts/runEchoAdmin.ts`. Configure privately in the service dashboard:

- `ECHO_ENABLED=true`
- `ECHO_MODE=alerts` (every other mode fails startup)
- `OWNER_CHAT_ID` and `ECHO_ADMIN_CHAT_ID`: identical positive private-owner ID
- `TELEGRAM_BOT_TOKEN`: existing bot token; worker only sends, never polls Telegram
- `ECHO_WEBHOOK_AUTH`: random secret of at least 32 characters
- `ECHO_SOLANA_RPC_URL`: HTTPS Solana mainnet RPC
- `ECHO_STATE_PATH=/data/echo-deliveries.json` on the persistent volume
- `PORT`: platform-assigned port

Create an enhanced Helius webhook for SWAP transactions, with only the four
wallet addresses. Point it at `https://<worker-domain>/helius`, with authHeader
equal to ECHO_WEBHOOK_AUTH. Do not put credentials in URLs or logs. Provider
entitlements/credits must be checked before activating; do not upgrade a plan
automatically. No API keys are requested in chat.

Health endpoint `/health` reports receiver availability, mode and last delivery/error
times. It does not prove that the provider subscription is active. Verify a real
supported trade against its on-chain transaction and admin receipt before calling
the pilot live. Test no Pro/Free messages, provider retries, restart dedup, missed
or delayed callbacks and provider usage. Do not send dummy alerts to subscribers.

## Delivery limitations

Authenticated callbacks are processed serially; busy receivers return 503 for
provider retry rather than buffering indefinitely. Requests and upstream calls
are bounded. Successful delivery IDs are atomically persisted, retained 24 hours
and capped at 10,000. Events expire after 120 seconds; prolonged outages can miss
alerts. There is no recovery backfill yet. Telegram has no idempotency key: a
crash/timeout between sending and persisting acknowledgment can cause a duplicate.
No exactly-once or immediate-execution guarantee is made.

## Paper and live trading follow-up

`openPaperStop`/`updatePaperStop` provide tested offline stop calculations matching
the existing ROI tiers. They do not open simulated positions or claim fills.
Paper fills require executable entry/exit quotes at observation time, fees,
slippage, quote freshness, persistent positions and restart tests. Live execution
requires a separate wallet, small explicit sizing and loss limits, security/sell
route validation and an emergency switch. No private key belongs on this receiver.

## Sources checked 21 October 2026

- https://github.com/helius-labs/core-ai/blob/main/helius-plugin/skills/build/references/webhooks.md
- https://github.com/helius-labs/core-ai/blob/main/helius-plugin/skills/build/references/enhanced-transactions.md
- https://pump.fun/profile/cupsey
- https://pump.fun/profile/thedetective
- https://pump.fun/profile/croakie
- https://pump.fun/profile/chairman
