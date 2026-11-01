# AlphaOS Echo — event-driven monitoring decision (2026-11-01)

## Explicit operational constraints
- **WebSocket remains the production live path:** `logsSubscribe({mentions:[wallet]}, commitment:'confirmed')` for Slingoor and Chairman. A mention is not a signer BUY; after the cheap logs filter, Echo still must independently verify signer, swap route and wallet deltas from a transaction.
- **Historical completeness is a separate acceptance gate.** No count of fast delivered messages proves that every eligible signer BUY was detected. Persist existing fresh/archive cursors, never overwrite an unmatched prior checkpoint, and do not reset the private volume.
- **Trading OFF.** No automatic BUY, automatic SELL, signing, sending or new paid infrastructure.
- **Avoid unnecessary RPC:** When WebSocket notifications are flowing, perform no periodic head polling just because a historical cursor is pending. A missed notification can occur; reconnect must still trigger a bounded audit, with debt preserved if delayed by queue pressure or provider cooldown.

## Low-RPC design now in PR #274 (not deployed)
- 2 acknowledged wallet subscriptions on existing WebSocket.
- On (re)connection: bounded catch-up with the established wider-page limits if the RPC and queue are available; retain `pendingReconnectRecovery` while an audit is blocked/failed.
- Connected with active notifications: no head probes; queue and classifier keep the immediate priority path.
- Connected but no notifications for 15 min: one 100-signature head spot-check per wallet. **This is a spot-check and not proof of complete coverage.**
- Connected with an old gap: archive at most once/30 min; 1x100 signatures per wallet per scheduled pass (no 1000-row archival burst on the healthy WS path); original cursor remains open.
- Disconnected: bounded catch-up no more often than every 3 min, subject to provider cooldown. Reconnection gets higher budget than ordinary archive audit.
- Queue size >15 suppresses background work. Stored live notifications remain priority.
- Expose `headSpotchecks`, `archiveAudits`, `headCandidates`, `lastHeadAuditAtMs`, `lastArchiveAuditAtMs`, `pendingReconnectRecovery` and `lastNotificationAt` in runtime health output.

## Baseline and verification
- On 2026-11-01, Railway returned 66 BUY delivery events: 62 Slingoor and 4 Chairman, median 1.528 s, p95 2.194 s, max 2.496 s for these **detected** events. Zero `RPC_HTTP_FAILURE` entries in the checked day window, but repeated `FRESH_COVERAGE_INCOMPLETE` for Slingoor. Independent matching of a bounded two-second Slingoor on-chain window passed once; full-day completeness remains unproven (PR #273).
- Compare candidate vs baseline using actual runtime per-provider `getSignaturesForAddress`, `getTransaction`, 429 counts, WebSocket reconnects, message backlog/dropped, and live transaction-to-Telegram delay. No reduction in RPC alone justifies missing BUYs.
- Only consider deploying after code review and green typecheck/focused/full tests, with rollback and operator approval. This branch is a **draft**, not live.

## Yellowstone feasibility
- QuickNode documentation: Solana Yellowstone-compatible gRPC is included with Scale and Business plans; access requires separate gRPC connection and token. The active Echo Railway variable names currently expose only HTTP RPC and WSS, not gRPC. **Do not infer entitlement or enable/upgrade subscription.**
- If access is explicitly verified without purchases, run read-only side-by-side capture of identical Slingoor/Chairman signatures, no Telegram sends from shadow, and compare event arrival times, signature coverage, 429s, credits/bytes and recovery after a short disconnect. Switch only on replicated improvement without missed events.
- Public docs: https://www.quicknode.com/docs/solana/solana-grpc/overview and https://solana.com/docs/rpc/websocket/logssubscribe.
