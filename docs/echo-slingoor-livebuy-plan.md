# AlphaOS Echo — Slingoor live-buy preparation (NOT ACTIVE)

## Locked user requirements
- Eligible for real-money BUY: Slingoor only, wallet `5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij`.
- Hard ceiling: 0.1 SOL per purchase; require a separate daily spending cap before activation.
- Live execution OFF until explicit user approval after tests and deployment review.
- Auto-sell OFF; user sells externally/manually.
- At most one real-money purchase per (execution wallet, mint), regardless of how many times the caller buys.
- Keep all other callers in research/alert-only mode. Do not delete historical alerts or outcomes.
- No private key values in code, logs, PRs or Telegram.

## Durable admission ledger (required before activation)
Use a shared transactional database, not an in-memory Set or process-local JSON file:
```sql
create table if not exists echo_live_buy_intents (
  wallet text not null,
  mint text not null,
  caller_wallet text not null,
  source_signature text not null,
  amount_lamports bigint not null check (amount_lamports > 0 and amount_lamports <= 100000000),
  state text not null check (state in ('reserved','signed','submitted','confirmed','failed_preflight','unknown','expired_unresolved')),
  signed_transaction_ciphertext text,
  transaction_signature text,
  last_valid_block_height bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (wallet,mint)
);
```
Never automatically remove a ledger row or release the unique (wallet,mint) reservation after failure. Manual review required before any new intent for that token. For a real implementation encrypt signed payloads at rest or store them in a secured signing service; never put signed bytes in normal logs.

## Safe lifecycle
1. Validate the caller BUY from an actual successful on-chain swap; exclude transfers/airdrops, reject stale events.
2. Check liquidity, mint safety, price impact, fees, route availability, quote expiry, and budget. Reject rather than chase extreme slippage.
3. Atomically INSERT the unique wallet+mint intent before signing. If conflict, suppress; if DB unavailable, fail closed.
4. Sign once, durably persist the signed transaction bytes/signature and expiry before broadcasting. If persistence fails, do not broadcast.
5. On transient network failure, resend **the same signed transaction**, not a newly signed purchase.
6. Reconcile signature status, token balance change, and blockheight before classifying an outcome. On ambiguous status, lock the intent and halt further attempts; never auto-re-sign.
7. Only report a confirmed BUY after on-chain verification. Track entry amount, fees, received quantity, transaction signature, and confirmation latency.
8. Selling remains entirely manual. Never schedule or submit an auto-sell.

## Operational blockers / acceptance
- Existing `src/core/adminTrading.ts` deliberately disables on-chain execution; leave this safeguard in place until a separate, reviewed and explicitly approved change.
- Echo RPC `getSignaturesForAddress` HTTP 429 failures and 120-second queue expiry require remediation before live execution.
- Verify production wallet public address matches the intended wallet without exposing its private key.
- Confirm persistence across restarts and concurrent workers, atomic uniqueness, signed-payload recovery, RPC timeout/429 handling, blockhash expiry, and ambiguous confirmations.
- Test no duplicate buys for 5 repeated caller BUYs, concurrent arrivals, service restart mid-broadcast, RPC timeout after acceptance, failed quote, low balance, insufficient liquidity, and manual-sell-only behavior.
- Require explicit activation approval **after** presenting passing test evidence. Never auto-deploy or auto-enable trading from this branch.

## Current status
Preparation-only policy file `src/echo/liveBuyPolicy.ts`. It is not wired into an execution path. No orders can be placed by this change.
