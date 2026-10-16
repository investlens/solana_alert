# Project Intelligence — isolated Pro candidate

Status: **NOT READY FOR PUBLIC DEPLOYMENT**. No existing alert worker, source file,
configuration, timing, database schema or production service was modified.
All implementation lives under `features/project-intelligence`, with separate tests in its own folder.

## What is implemented

- Separate HTTP worker and Telegram Mini App report page; no bot polling, webhook
  replacement, event listener registration, existing alert queues or scheduler imports.
- Telegram signed init-data authentication (15-minute validity), plus server-side
  active paid/admin membership checks. Free/tester access cannot bypass the gate.
  Blocked/expired members cannot obtain reports or start tracking.
- Read-only providers with explicit chain checks, response/deadline/request limits,
  and exact chain/token/pool matching. Provider URLs and credentials are never logged.
- Pinned-block token supply, owner and balances. End-of-report block-hash check
  removes chain-derived assertions if the snapshot cannot be revalidated.
- Developer attribution requires a canonical direct-deployment sender/nonce proof or an exact approved PONS factory event, with at least 12 confirmations.
  A factory address or a provider's `creator_address` is not presented as a verified
  human/project developer.
- Bounded direct token recipients and confirmed native-funding connections;
  current holdings cross-checked on chain. Unique addresses counted once.
  Contract recipients are excluded from the connected EOA exposure calculation;
  failed code reads cannot turn a contract into an EOA.
- Sampled holders: at most 8 holder candidates plus up to 5 linked candidates,
  with at most 11 unique addresses read. Identified pool/burn accounts excluded.
  Unknown address purpose remains unknown. No claim of a complete holder census.
- Prior direct token deployments: first 50 explorer transactions, at most 3
  creation candidates independently checked. No lifetime-history or prior-rug claim.
- GoPlus flags are explicitly SOURCE_REPORTED, never an independent safety proof.
- Listed social links and optional social-provider adapter: exact linked-account
  attribution, up to 30 posts in 30 days, future/duplicate posts excluded, simple
  repeated-text counts. No legitimacy, bot-engagement or account-ownership score.
- Exact-pool selling simulation reuses the existing tested pure verifier with
  feature-owned RPC dependencies. The existing alert governor/default transports
  are not invoked. The verifier's eight-second cancellation is preserved.
- Opt-in Track/Untrack: 3 tracks/member, **10 tracks total in this pilot**, seven-day
  expiry, separate Redis state. Earliest-due-first scheduling, max 2 checks/minute.
  Checks generally take 5–10 minutes under capacity; this is not instant protection.
- Track preserves the original baseline and compares subsequent observations.
  Balance decreases are not called sells; liquidity valuation falls are not called
  withdrawals; unknown reads cannot become zero balances. Notifications identify
  their observation time. A persisted HELD state prevents replay of ambiguous sends.
  This prioritizes duplicate prevention; an ambiguous send may be missed and needs
  manual inspection. No guaranteed delivery claim is made.

## Accuracy labels

VERIFIED: independently read or receipt-checked on the selected chain.
SOURCE_REPORTED: attributed third-party statement, not independently established.
OBSERVED_CONNECTION: transfer/funding relationship established; ownership unconfirmed.
UNVERIFIED: evidence missing, unsupported, incomplete, stale or unavailable.

There is no combined safety score and no buy/sell recommendation. A project can
have verified ownership and still have severe contract or liquidity risks.

## Live validation on 15 October 2026 (India)

A bounded live probe used Dividend Hound on Robinhood:
`0xa3cc6b9a798573bb622fef64dd6f2bafdcfff71a`.
See `live-robinhood-check.json` for the reproducible feature-pipeline result.
The public explorer/market probes failed; a separate DexScreener probe confirmed
HTTP 403 with code 1010. The explorer HTTP failures were not independently resolved. A separate GoPlus probe returned a response,
but this does not validate the missing on-chain, history or social findings.
The feature pipeline's short deadlines produced incomplete live coverage, which
was correctly displayed as unavailable. This is **not evidence that these tokens
have no developer, no side wallets or no risk**.

The previous native-ETH alert simulation validation is not substituted for a full
Project Intelligence validation. No production token research report, subscription,
tracking notification or real trade was created during development.

An additional ARC smoke probe targets the configured native-quote contract
`0x3600000000000000000000000000000000000000`; this is an infrastructure smoke
check, not a reference project/developer validation. See `live-arc-smoke-check.json`.

## Explicit remaining coverage gaps / release gates

1. Configure independently scoped research RPC and explorer access for **both**
   Robinhood and ARC; verify chain IDs and historical/receipt/log support. Use a
   dedicated quota so research cannot exhaust the alert services' provider quota.
2. Add and validate a social-post provider. Public listing links alone do not
   establish account age, substantive activity, authenticity or project claims.
3. PONS factory-event attribution is implemented with receipt/block matching and conflicting-creator rejection. Validate real factory reference cases using the dedicated provider. Comprehensive factory launch history is still incomplete.
4. Retained developer outcomes and up to three recent measured Robinhood winners are now readable with exact indexed wallet queries. Broad prior-launch outcomes, lock contract/expiry verification, comprehensive
   wallet tracing, developer swap attribution, connected-wallet coordination and
   website/claim corroboration are not yet implemented or validated.
5. Build a manually reviewed reference set across both chains: direct and factory
   launches, exchange/shared funding, contract recipients, duplicates, mintable and
   restricted tokens, unlocked/unknown LP, unavailable providers and reorg cases.
   Confirm each published figure against its transaction/block/source.
6. Exercise Redis compare-and-set and restart/ambiguous-send recovery against the
   **dedicated** staging store; validate signed Mini App → membership → report →
   opt-in track → stop/expiry end to end. This was not tested against production.
7. Measure latency and quotas with alert workers running unchanged. Deploy only the
   separate service once all relevant gates pass; do not merge/deploy as a promise
   that all desired information is available.

## Run and configure (not applied)

Typecheck: `node node_modules/typescript/bin/tsc -p features/project-intelligence/tsconfig.json`

Tests: `node --import tsx --test features/project-intelligence/tests/*.test.ts`

Read-only live probe:
`NODE_USE_ENV_PROXY=1 node --import tsx features/project-intelligence/validate.ts --live --chain robinhood --token CONTRACT --out report.json`

Separate worker start: `node --import tsx features/project-intelligence/server.ts`

Use `features/project-intelligence/railway.json` as the new service config path.
Enable only after validation with `PROJECT_INTELLIGENCE_ENABLED=true`.
Required secrets/settings belong in the new worker's secret settings, never chat:

- `PI_TELEGRAM_BOT_TOKEN`: existing bot token for signed Mini App validation and
  explicitly opted-in notifications only. There is no polling or webhook change.
- `PI_SUPABASE_URL`, `PI_SUPABASE_SERVICE_KEY`: server-only membership lookup of
  existing users. No writes/migrations. A scoped membership gateway would further
  reduce credential permissions before public launch.
- `PI_REDIS_URL`: dedicated research Redis, not the alert Redis connection.
- `PI_ROBINHOOD_RPC_URL`, `PI_ARC_RPC_URL`: independent research provider quota.
- `PI_ROBINHOOD_EXPLORER_URL`, `PI_ARC_EXPLORER_URL`: complete API bases including
  `/api/v2`, e.g. `https://api.blockscout.com/4663/api/v2` when supported.
- Optional `PI_BLOCKSCOUT_KEY`: sent only to exact `api.blockscout.com` origin.
- Optional `PI_GOPLUS_KEY`: dedicated provider access where supported.
- `PI_SOCIAL_PROVIDER_URL`, `PI_SOCIAL_PROVIDER_KEY`: configured trusted adapter;
  request `{url,limit:30}`, response `{profileUrl,posts:[{url,text,publishedAt}]}`.
  Validate provider coverage and attribution before enabling the social section.

Resource limits: one research job at a time; same-token requests coalesce; five-minute
cache capped at 100 reports; six API research requests/member/minute; 40 provider
requests/report; 60 provider requests/minute across this process; 256KB/source
response; 30-second report deadline; 5-second source deadlines. Deploy one replica
for the pilot. A distributed quota/queue would be required before scaling replicas.

Documentation consulted: Blockscout address API, official Blockscout PRO API guide,
DexScreener reference and Telegram Mini App validation specification. Authenticated
explorer access must be validated with the supplied provider plan, not assumed.

## 16 October 2026 update

Rebased onto the production release containing returning-winner alerts. Changes remain exclusively in the feature, its documentation and isolated CI workflow. No production configuration or schema was changed.

- Direct-deployer attribution now reuses the established pure sender/nonce/canonical-block verifier.
- PONS attribution decodes the approved factory version event with exact token, transaction, block and deployment-range checks. Transaction callers are not substituted for the developer. Twelve confirmations required.
- Developer holding and connected-wallet reads use this strengthened attribution. A failed final snapshot validation also removes the report block to prevent incomplete reports from qualifying for tracking comparisons.
- Existing retained developer counters and latest three winner references are read using two bounded, exact-chain/exact-wallet REST queries after creator verification. Summary counters are historical sessions, not lifetime launches. Winner ROI is recalculated from retained samples and labelled USD versus reserve ratio; ARC winner-reference coverage remains unavailable. Reads are read-only and benefit from the existing five-minute same-token report cache.
- Strict feature typecheck and all 22 feature tests passed; all 989 existing tests passed.
- Live database field queries succeeded. The public Robinhood probe remained incomplete; it is not release validation. No dedicated research service or PI configuration was found in the current Railway project. No existing service was changed, no new resource provisioned, and no test Telegram message was sent.

Remaining release work: dedicated research RPC/explorer quota for both chains; social provider validation; independent LP lock evidence; reviewed live reference cases; separate Redis and full authenticated Mini App/track/restart validation. These gates remain unresolved, so this draft is not publicly deployable.
