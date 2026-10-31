# Echo live BUY latency evidence — 2026-10-31

This report separates **observed Railway production alert delivery** from
the **not-yet-deployed shadow timing instrumentation**. No signer or live
trading has been activated.

## Observed baseline (read-only Railway logs)

- Project/service: `alphaos-engine / alphaos-echo-admin`
- Deployed source: `fix/echo-fresh-adaptive-budget-20261030`
- Deployment source commit: `931412713c5718a21ff4880ad3400f44dd6ee16d`
- Sampling window: 2026-10-30T15:35:00Z through 2026-10-31T15:35:00Z
- Evidence: `[Echo] RESEARCH_EVENT` deploy logs, **BUY** only,
  deduplicated by transaction signature
- Chain-to-Telegram delivery = `(deliveryAt - tradeAt) * 1000`
- Solana `tradeAt` block time is coarse (seconds); this is approximate
  **chain-to-alert delivery**, not WebSocket detection, quote or execution.

| Caller | Verified BUY log events | Median delay | p95 delay |
| --- | ---: | ---: | ---: |
| Slingoor | 12 | 2,096 ms | 2,384 ms |
| Chairman | 3 | 2,203 ms | 2,362 ms |

These are small samples; they do NOT demonstrate the 5s caller-age or 1.2s
quote-age limits at a future signing/decision boundary. A 2-second Telegram
alert does not imply a BUY can execute that quickly.

## Draft instrumentation

`src/echo/verifiedBuyLatencyTracker.ts` (wired into
`scripts/runEchoQuicknode.ts` in PR #267):
- Records accepted WebSocket signature arrival with a bounded per-wallet map.
- Records independently classified BUY events **before Telegram delivery**.
- Summarizes detection age, queue wait, verification, stale count, p50/p95.
- Separates WebSocket observations from historical reconciliation.
- Suppresses repeated metrics when Telegram delivery retries a transaction.
- Emits no sensitive signatures, addresses, API keys, or raw swap bytes.
- Exposes only compact status in Echo health and periodic health logs.
- Marks `quote`, `reservation`, `decision` as **NOT_CONNECTED**, not
  pretend zero-duration operations.

### Real shadow acceptance remaining

A reviewed alert-only rollout of the draft code to the **isolated Echo
service** is required to observe actual stage breakdowns on new caller buys.
No rollout is authorized by this document; do not deploy without approval.
The main AlphaOS Solana alert bot must not be modified.

A later independent provider-backed quote must accurately size $10 from a
fresh SOL/USD rate, verify caller input asset and raw token decimals, and
compute the worst-case entry markup including slippage. It must record quote
request/response and successful/denied atomic reservation timestamps.
Until such a quote path exists, no claims about quote/decision latency or
signer readiness are justified.

Production real trading and automatic SELL remain OFF.
