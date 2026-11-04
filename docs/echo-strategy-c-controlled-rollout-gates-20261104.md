# AlphaOS Echo Strategy C — controlled paper-only rollout acceptance

**Status: HOLD. No production change authorized by this checklist alone.**

## Verified 2026-11-04 baseline
- Current Railway service: `alphaos-echo-admin`, ID `92734a90-45e3-45fb-a314-414d6c313f1b`.
- Current source branch: `feat/echo-event-driven-reconciliation-20261101`, commit `b8943b0bfb74f223972e457c2ef93ed78186de09`.
- Current successful deployment: `73e03032-6ce0-46f0-a83b-8f01be1b785e`. Railway reports `canRollback=true` and `canRedeploy=true`.
- Existing persistent volume: `alphaos-echo-state`, 500 MB, `/data`. Do NOT detach, replace, resize, or delete.
- Proposed minimal candidate: PR #281, branch `feat/echo-strategy-c-shadow-live-base-20261104`, based on exact original deployed commit. Only seven changed files. CI run `41756208507`: success.
- The code flag is opt-in: `ECHO_BOOST_STRATEGY_C_SHADOW_ENABLED=true`. It is absent in the current Railway variable-name inventory. Missing/false means no Strategy C shadow and no additional price fetches.
- Live trading remains OFF. No keys, swap instructions, signing, or broadcasts are part of Strategy C.

## Recovery and state safety gates — MUST ALL PASS BEFORE ROLLOUT
1. Verify **an actual independent recovery of the production Supabase database**, not merely that a daily physical backup exists or that a synthetic Postgres restore passed. Obtain recovery artifact ID, time, and required integrity checks. Do not click Restore on the live project.
2. Before any Echo admin restart or source switch, capture a **separate validated, private snapshot of `/data`** (not just a Railway build rollback). Confirm the existing `*.research-v1.json` data and `onceMints` uniqueness ledger remain readable and durable. Never commit or expose the journal in GitHub, chat or build logs.
3. Validate the source revision is still `b8943b0b`, there are no staged Railway changes, the 500 MB volume is mounted at `/data`, and current alert-to-Telegram and research heartbeat are healthy.
4. Keep `ADMIN_TRADING_ENABLED=false`, `ECHO_SIGNED_BUY_DRY_RUN_BROADCAST_ENABLED=false`, `ECHO_ONE_SHOT_HANDOFF_BROADCAST_ENABLED=false`, and `AUTO_TRADE_MODE=paper`. Independently validate actual variable values through approved secret-safe controls; names alone do not prove values.
5. Review and approve paper-only deployment separately from any real-money BUY authorization. No new paid services or volume additions.
6. Deploy the reviewed minimal commit only to the Echo admin service, while preserving mounted data, Telegram config, user alerts, owner controls and all other Railway services. Activate the flag only after the code deploy is healthy.
7. Verify post-rollout: deployment status and health endpoint; fresh BOOST entry, 1-minute research sample and Strategy C shadow metrics; no extra price HTTP calls; no duplicate entry; only forward-start BOOST trials included; existing baseline and milestones unchanged; **no real trades**.
8. If latency, notifications, research persistence, CPU/disk or error rate regress: immediately deactivate the flag, **revert the app to deployment `73e03032-6ce0-46f0-a83b-8f01be1b785e`**, and verify volume/journal integrity. Do not delete the volume. Note code rollback does not reverse already-written journal fields, so snapshot validation is essential.

## Reporting discipline
- Compare Strategy A vs C only for positions that have actually closed under both models, using $10 paper entry, estimated fees, mark-only assumptions.
- Open runners, post-exit 100x milestones and missing price observations are **not realized profit**.
- Claims of actual sellability require independently verified route depth and on-chain trade evidence.

**No live auto-BUY, no production SQL migrations, no funding, and no storage restoration are performed by this runbook.**
