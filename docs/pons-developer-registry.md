# Pons developer registry

The registry is a derived, refreshable view of exact-token Pons outcome evidence. `pons_launches` remains the authoritative census and is never deleted by classification or blocking. `pons_token_outcomes` preserves the evidence used by the registry.

Positive tiers are `LEGEND`, `KING`, `GEM`, `PROVEN`, `PROMISING`, then `UNKNOWN`. Risk precedence is `SCAMMER`, `SPAM_LAUNCHER`, then `HIGH_RISK` before any positive tier when its evidence rule is satisfied. Tier and sample confidence are stored separately.

Refresh all developers with `npm run pons:refresh-dev-registry`. Use `-- --deployer=0x...` for one normalized address or `-- --limit=100` for a bounded refresh.

`shouldIgnorePonsDeveloper(address)` returns the block decision, reason, tier, and evidence summary. Future live processing can call it before market enrichment, momentum tracking, AI scoring, trading evaluation, or normal alerts. Derived caches may be cleaned separately, but cleanup must preserve `pons_launches`, `pons_token_outcomes`, `pons_developer_registry`, and the stored block evidence.

## Live launch intelligence

Live intelligence has three independent, disabled-by-default flags:

- `PONS_LIVE_INTELLIGENCE_ENABLED`
- `PONS_PROVEN_DEV_ALERTS_ENABLED`
- `PONS_PROVEN_DEV_SHADOW_BUY_ENABLED`

`PONS_PROVEN_DEV_CONFIRMATION_SECONDS` defaults to 30. The detector uses dedicated `live:<factory-id>` checkpoints in the existing checkpoint table, so it cannot advance historical backfill state. Blocked developers stop before market lookup and momentum work. GEM, KING, and LEGEND launches can produce an immediate priority payload followed by an exact-token shadow decision. There is no transaction executor in this path.

The `pons:live-dev -- --once` command is deliberately read-only for launch/checkpoint state and performs no real trades.

With live intelligence explicitly enabled, `pons:live-dev` runs continuously in shadow mode. It defaults to a five-second poll interval, configurable with `PONS_LIVE_POLL_INTERVAL_MS`, and persists only the dedicated live checkpoint plus idempotent census launch rows. `--once` and `--replay-token=...` remain read-only.

Production alert-only mode sets live intelligence and proven-developer alerts to `true`, while keeping shadow buy and all trading flags disabled. Proven alerts use the existing durable semantic-event and Telegram delivery ledgers, keyed by canonical Pons launch identity. A failed Telegram delivery is contained and the watcher continues.

Developer learning remains asynchronous: schedule `npm run pons:learn-devs -- --limit=100` separately from the live watcher. It reuses the exact-token outcome collector and registry refresh services; live launch detection never waits for it.
