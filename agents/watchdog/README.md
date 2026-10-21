# AlphaOS AI watchdog — isolated preparation

This optional worker is separate from the main, PONS and ARC alert processes. No existing files, launch commands, alert policies, timings, database tables or production services are modified. It uses Node's built-in libraries only, with no added npm dependencies.

## Status

Prepared and locally tested; not deployed. Live MCP scan snapshots from all three production services were assessed successfully in an offline run. Direct Railway GraphQL calls and Gemini calls are mock-tested only until private credentials are configured. No real Gemini call, admin Telegram notification, UI page, repair action or trading capability is enabled.

ARC's independent real-pool buy/full-sell validation remains outstanding. This worker does not solve that gap or approve tokens with missing security evidence.

## What it checks

Four fixed Railway read-only GraphQL requests at most every five minutes: one deployment-status query, then up to three filtered log reads. Logs are restricted to the latest ten minutes and 200 matching lines per service. The entire collection has a shared 20-second deadline and bounded response sizes. Cycles never overlap; no automatic retries.

It checks main older-token scanner progress, PONS current-factory scan progress, ARC pool scan progress, repeated actual timeout events and supported Telegram delivery failure markers. Deployment SUCCESS is not replica health. Scan progress is not full feature coverage. No alert for a period is not considered an incident. Missing or truncated logs are unknown evidence, not proof of a stopped scanner. The first version does not inspect token security, scanner backlog freshness, RPC fallback completion, all delivery formats, provider rate limiting, winners or PONS paid-event completeness.

AI receives only enumerated incident kinds, service aliases, numeric counts and evidence IDs. Raw logs, API keys, wallet addresses, subscriber details, database credentials and URLs are not sent to Gemini. The model chooses a supported hypothesis and next diagnostic check; code rejects invented citations and unsupported action/hypothesis combinations. Findings are admin operator log output only. The model has no tools and cannot execute its suggestion.

## Cost and limits

Default disabled. Gemini explanations are separately disabled. AI is called only for a new incident; at most four attempts per UTC day and one per 30 minutes. Failed calls count toward this cap. Repeated incidents are deduplicated; a resolved incident can recur after cooldown. A 429 retains the deterministic report with no retry or paid fallback. Model output is capped at 1,024 tokens and response body at 32 KiB. There is no background AI for healthy scans.

A persistent volume and one replica are required before enabling AI. The worker refuses AI calls without `WATCHDOG_STATE_PATH` and `WATCHDOG_PERSISTENT_STATE_CONFIRMED=true`. State is saved before the model call, atomically, with restricted permissions. Corrupt state pauses AI rather than resetting the budget. Daily caps assume the persistent state file is retained; do not delete it to recover a running service. Railway hosting/volume charges are separate from Gemini's free API quota. Use a Google project on the free API tier; a request cap alone does not make a billing-enabled Google project free.

## Setup after review

1. Create a dedicated Gemini API key privately in Google AI Studio. Confirm the configured model is available within that project's free quota.
2. Create a Railway project token scoped to AlphaOS production. This is narrower than an account-wide token but is **not inherently read-only**: this worker only issues fixed `query` operations. Keep it server-side, never include it in model input, and revoke it if the worker is removed. No Supabase or Telegram token is needed for this preparation.
3. Deploy a **new** `alphaos-ai-watchdog` service from this feature branch with root directory `/agents/watchdog`, start command `node run.mjs`, one replica, and a persistent volume at `/data`. Do not merge it into a live branch merely to run it. Do not change any existing service.
4. Add `WATCHDOG_RAILWAY_PROJECT_TOKEN` privately on the new service. Enable only `ALPHAOS_AI_WATCHDOG_ENABLED=true` first. Validate actual fixed GraphQL reads, scan timestamps and failure behavior.
5. Add `GEMINI_API_KEY`, select `GEMINI_MODEL`, confirm persistent storage, then enable explanations. Run one controlled diagnostic with sanitized evidence before relying on them. Real incidents remain necessary to validate operations end to end.

Do not paste keys into chat, commits, PRs or test fixtures. Gemini free-tier data handling permits product improvement; send only the sanitized evidence implemented here.

## Local checks

```sh
cd agents/watchdog
npm test
node run.mjs
node run.mjs --snapshot /absolute/path/to/operator-snapshot.json
```

Disabled startup performs no network calls. Snapshot mode never calls Gemini even if the environment enables explanations. Snapshot input is capped at 1 MiB. Tests cover quiet markets, stale/missing evidence, cumulative counters, sanitization, model grounding, cap persistence, recurrence, oversized responses, fixed read queries, partial provider failure and 429 behavior.

Sources: [Railway runtime logs API](https://docs.railway.com/integrations/api/manage-deployments), [Railway API authentication](https://docs.railway.com/integrations/api), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).
