# AlphaOS Echo — alert-only deployment gate (2026-10-27)

## Scope and non-negotiables
- Caller wallets monitored: Slingoor `5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij` and independently cross-checked Pump.fun Chairman `Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6`.
- Never delete Croakie, Cupsey, Thedetective or other caller research history; only remove from ACTIVE registry.
- Notify only successfully executed, signer-authorized BUY swaps with an evidenced asset debit and net token credit. Incoming transfers, unsolicited airdrops, failed transactions and SELLs must not become BUYs.
- Prefer one signal per verified outer route signature, not one per intermediate DEX leg.
- Live auto-buy OFF, auto-sell OFF, user authorization required for any future real-money execution.
- Existing Railway service/volume: `alphaos-echo-admin`, `/data`. No additional Railway service or paid Birdeye subscription.
- Code lives in draft PR #247, isolated from production branch. Do not deploy without user approval.

## Verified technical evidence
- 26 Oct 14:32 UTC: production QuickNode connected with five subscriptions and zero RPC failures. 14:33 UTC: zero active subscriptions and first recurring `getSignaturesForAddress` HTTP 429; subsequent intermittent recoveries and over 2,200 reconnects.
- Old parser only accepted Pump.fun/PumpSwap and missed Slingoor's verified Jupiter v6 `route_v2` swap.
- Real transaction signature `5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed`: successful, Slingoor signer; debit 10,000,000 units of `8BnNS15Q6h6D5Vcq1sNPaUxhpRVdK8FGRbLvCrLxibSx`, credit 58,303,920.038395 units of `67swHekykm7copiKAufdV9yuPC68mUFs4epsaKympump`. Code now classifies this exact historical transaction as ONE BUY.
- CI complete: TypeScript, focused regression tests, and full repository tests pass. Must rerun at final head SHA before merging.
- QuickNode 429 means method, per-second, concurrent or plan quota; source-specific reason NOT YET VERIFIED.

## Optional no-subscription fallback
Environment variables recognized by the new alert-only code:
- `ECHO_FALLBACK_SOLANA_RPC_URL` — HTTPS Solana RPC from an independent provider
- `ECHO_FALLBACK_SOLANA_WS_URL` — WSS matching the same independent provider host

Both must be set together or both omitted. Primary QuickNode URLs stay unchanged.
Existing Helius account may be reused IF free credits remain. Helius standard WebSockets are allowed on its free plan, subject to plan limits. Securely reference the key via Railway service variables; NEVER copy a key into source code, GitHub Actions, this document, or Telegram. Do not set these variables or stage/deploy without user approval.

Recovery logic:
- On three consecutive unsuccessful primary subscription attempts, switch to the secondary WSS endpoint if configured, with health indicators showing only 'primary'/'fallback', never token URLs.
- When primary RPC is rate-limited/unavailable, request read-only transactions from the independently configured backup. No duplicate successful requests; no transaction submission.
- Continue confirmed BUY classification through on-chain signer/asset accounting; no trading operations.
- If both providers unavailable, mark unhealthy and preserve the pending signature queue, do not fabricate or send alerts.

## Required pre-deployment observations
1. In QuickNode > Endpoint > Metrics (or Usage & Billing), inspect 26 Oct 14:30-14:40 UTC and recent windows. Distinguish RPS/method 429, API-credit caps, subscription quotas and WSS close codes. Confirm endpoint and plan are active. Do not paste secrets into logs/screenshots.
2. Verify production vs staging config by names only; ensure `ECHO_STATE_PATH` lives under /data and an additional `.pending-v1.json` file can be written to the same volume by the single running worker.
3. Confirm no accidental live trade enablement; `src/core/adminTrading.ts` still blocks on-chain trade execution.
4. CI at HEAD must pass TypeScript, focused Echo tests and the full suite. Review changes for request cost and false BUYs.
5. In a controlled alert-only rollout *after user approval*, observe one or two acknowledged subscriptions continuously without repeated reconnect storms; fall back to secondary provider when the primary reaches 429 if configured.
6. Reconcile at least 10 real Slingoor transactions against independent explorer data. Confirm matched signatures with correct exact token and input, recognize routed swaps, and reject transfers and SELLs.
7. Observe one real recent Slingoor BUY delivered to the intended private Telegram chat exactly once, with timestamp/age and link. Check delivery delay and that a duplicate repeated source notification does not create a second alert.
8. Record any 30-minute signature coverage gap and transaction-backlog saturation, rather than claiming 100% completeness. Only after these checks can the user be told the **alert-only** deployment is ready to approve.

## Rollback / incident safeguards
- Preserve existing production branch and deployment ID for immediate rollback, with no change to volumes or historical state. Keep the old service available until the new one demonstrates healthy subscriptions.
- If unexpected 429 storms, malformed notifications or queue persistence failures occur, halt rollout/rollback and leave auto-buy OFF.
- Do not promise 'instant' latency; record actual transaction-to-Telegram delay and show age explicitly.
