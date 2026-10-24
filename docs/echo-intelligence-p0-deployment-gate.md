# Echo Intelligence P0 — deployment gate

Feature branch: `feat/echo-intelligence-p0-20261024`.
**NOT DEPLOYED.** Live Echo should remain on `feat/echo-admin-pilot-20261021`.

## New behavior (research only)
- After Telegram confirms a supported BUY alert, record caller/mint/signature/deliveryAt into a private state file alongside the existing Echo dedupe state: `<ECHO_STATE_PATH>.research-v1.json`.
- Every ~60s (best effort), query DexScreener once per unique active mint (bounded 16 tracked opportunities maximum, deduplicated mints). Record timestamped USD *mark prices* and pinned initial pool. Record paper stop using unmodified `openPaperStop`/`updatePaperStop`, plus 5m/15m/30m/1h/6h/24h checkpoints.
- Preserve observed price series for 24h even after paper stop triggered. Final outcomes reported via `[EchoResearch] OUTCOME` and saved to persistent state (up to 30 days).
- Historical signatures before rollout are **not backfilled** by this feature. Collector observations are not a substitute for verified historical OHLC/transaction reconstruction.
- On corrupt research state, collector remains disabled and Telegram remains enabled. Main PONS/ARC/Robin services untouched. No trade-execution imports.

## Gate before deployment (NOT YET COMPLETED)
1. Run `npm ci && npm run typecheck && npm test` on feature branch; fix all issues.
2. Test first 24h samples with synthetic price progression and gaps: correct stop, initial stop, no price, no pool, repeated same signature, idempotent restart.
3. Check whether separate feature branch triggers automatic Railway deploy. Verify live branch stays unchanged.
4. Ensure Echo Railway volume exists and `ECHO_STATE_PATH` is on it. Ensure exactly ONE Echo replica and bounded per-minute source queries.
5. Validate DexScreener `priceUsd`, pool pinning, 429/backoff behavior, and alert/card latency. Mark price only, not executable exit price.
6. Explicit user approval before deployment (company charter). Roll back immediately if alert latency, queue size or RPC errors worsen.
7. Check `[EchoResearch] BUY_RECORDED`, `[EchoResearch] OUTCOME`, `[Echo] HEALTH.research` after deployment. Only after sufficient 24h trajectories publish first caller statistics.

## Known limitations
- Live point samples miss intra-minute spikes/stops; gaps are valued at next observed mark, not an executable quote.
- A BUY signal lost before research persistence can be omitted even if Telegram was accepted. Need replay repair/reconcile for production-grade completeness.
- No Supabase aggregation, historical-price backfill or out-of-sample pattern model yet.
- `maxActive=16` bounds workload but will cap samples at high volume. CAP_REACHED must be counted, not silently called a loss.
- No automated alert-model rule changes; no live auto-trading.

## Rollout: research-first and safe
Promote after typecheck and test, then deploy to existing Echo service in a controlled window. Observe HEALTH and 24h collector coverage before expanding wallet cohort.
