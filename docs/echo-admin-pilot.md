# AlphaOS Echo — QuickNode admin pilot

The current pilot uses standard Solana HTTPS RPC plus WebSocket subscriptions.
It does not require Helius. The original enhanced-webhook receiver remains an
unused standalone draft, not the deployment entrypoint.

No shared bot startup, subscriber delivery, chain services, settings or schemas
are modified. No private key or trading execution is used. Live buys are not
implemented. Stop calculations are offline helpers; simulated fills are pending.

## Coverage and accuracy

Watch the four public Pump profile wallets of Cupsey, Thedetective, Croakie and
Chairman. These are research candidates, not validated profitable traders.

Each wallet has a separate logsSubscribe at confirmed commitment. Only explicit
Pump.fun / PumpSwap buy, sell, buy_exact_sol_in and buy_exact_quote_in instructions
with pinned discriminators/account layouts can qualify. The watched wallet must
sign and be the instruction user; its specified token account must show the
matching mint, owner and net balance direction. Matching CPI instructions are
supported, but not every aggregator route preserves the watched wallet as user.
Other DEX venues and ambiguous multiple trades are withheld. This is not full
wallet trading coverage. A program mention, receipt, gift or transfer is not a buy.

Quote amounts are token-account net change where available. Native SOL wallet
changes include fees and account rent and are explicitly labelled. Unavailable
quote amounts stay unavailable. No quoted balance change is a claimed exact fill.
Alerts say security is not assessed. A trader's purchase does not bypass safety
checks for any future execution feature.

## Separate Railway service

Project: alphaos-engine; production environment.
Service: alphaos-echo-admin (92734a90-45e3-45fb-a314-414d6c313f1b).
One replica in us-west2; a 100 MB persistent volume at /data stores delivery
deduplication. The service is prepared without source or a running deployment.
Do not connect source until private endpoints are configured and CI has passed.

Start command: node --import tsx scripts/runEchoQuicknode.ts, Node 22.

Preconfigured privately on this new service:

- ECHO_ENABLED=true, ECHO_MODE=alerts
- ECHO_STATE_PATH=/data/echo-deliveries.json
- OWNER_CHAT_ID and ECHO_ADMIN_CHAT_ID: references to the main service's owner
- TELEGRAM_BOT_TOKEN: reference to the main service's bot token (send only)
- ADMIN_TRADING_ENABLED=false, AUTO_TRADE_MODE=paper

User supplies only these two private variables on **alphaos-echo-admin**:

- ECHO_SOLANA_RPC_URL: QuickNode HTTPS endpoint
- ECHO_SOLANA_WS_URL: same endpoint's WSS URL

Do not paste credentials in chat, commits, documentation or logs. Do not change
existing services' SOLANA_RPC_URL or flags. No marketplace add-on is needed.
Mainnet genesis and Telegram getMe are checked before subscribing. No test message
or getUpdates call is sent. No Helius authentication or webhook is required.

## Recovery, limits and diagnostics

The WebSocket adapter waits for all four subscription acknowledgments. Errors,
disconnects and subscription timeouts reconnect with 1–30 second backoff.
Each successful connection reconciles recent signatures; a second sweep runs
every minute: four address reads, at most 20 signatures each, no deep history.
Only observations with on-chain block times at most 120 seconds old can alert.
Outages longer than this and wallets with more than 20 signatures in the recovery
window can miss events. Reconciliation is bounded recovery, not complete replay.

A serial queue deduplicates pending signatures, caps at 64 jobs, and makes at most
three attempts per queued job. Every successful transaction is persistently marked
processed. Telegram acceptance is persisted per signal. Entries retain 24 hours
and cap at 10,000. HTTP calls time out after eight seconds; provider rate limits
back off. A lost Telegram acknowledgment/crash can still cause a duplicate because
Telegram does not expose an idempotency key. No exactly-once guarantee is made.

/health returns 503 unless all subscriptions acknowledged, reconciliation is
recent, no rate-limit backoff is active and the queue is below its warning limit.
It reports queue drops/reconnects and latest RPC/delivery/error/reconciliation
timestamps, without credentials. It cannot prove completeness of wallet coverage.

## Validation and rollout

Test parser behaviour for raw RPC JSON and PublicKey wrappers, signed buys/sells,
gifts, wrong ownership, failed/stale trades, quote attribution, config guards,
subscription acknowledgments/reconnects, queue bursts/retries, persistent dedup
and trailing-stop progression. Run TypeScript and the full repository suite.

After URLs are saved, deploy only the separate service from the Echo branch.
Verify actual QuickNode HTTP/WSS authentication, mainnet identity, four live
subscription acknowledgments and provider usage; then reconcile a real supported
wallet transaction with its admin receipt. No real admin receipt has been tested
yet. Do not describe the prepared worker as live or profitable before validation.

## Primary references checked 21 October 2026

### Transaction-version correction

Croakie's confirmed PumpSwap buy at 2026-10-21 16:23:34 UTC used transaction
version 1. The original request ceiling of 0 rejected it with RPC -32015.
The corrected reader explicitly requests maxSupportedTransactionVersion=1;
the existing JSON parser identifies its inner PumpSwap instruction without
relaxing owner, signer, failure or freshness checks. Its public transaction is
saved as tests/fixtures/echo-croakie-v1.json for regression coverage.

Private minute-level health logs now report RPC/delivery failures, queue drops,
parsed signal counts and accepted deliveries. RPC errors log numeric codes only,
never endpoints or credentials. ECHO_VALIDATE_V1_SIGNATURE optionally performs a
single historical API read at startup to validate provider v1 retrieval/parsing;
this diagnostic never queues or delivers the historical trade. Remove the
diagnostic variable after checking rollout logs. Missed old trades are not
reissued as fresh alerts.

- https://solana.com/developers/cookbook/transactions/versions

- https://solana.com/docs/rpc/websocket/logssubscribe
- https://solana.com/docs/rpc/http/gettransaction
- https://solana.com/docs/rpc/http/getsignaturesforaddress
- https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
- https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json
