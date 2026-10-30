# Echo executable swaps — API version and trust boundary (October 2026)

**Review only / not a production runbook.** No wallet secret, signing or
transaction submission is enabled by this document.

## API selection
Jupiter states that Metis Swap API v1 (`/swap/v1/quote`, `/swap/v1/swap`)
is no longer actively maintained and has been superseded by unified Swap
API v2 at `https://api.jup.ag/swap/v2`.
Before live execution, replace the preview-only `readOnlyJupiterSwap.ts`
v1 path with a reviewed v2 order/build integration, or separately confirm
an approved Pump.fun-native execution path for tokens not routable via v2.

Official references:
- https://developers.jup.ag/docs/swap
- https://developers.jup.ag/docs/swap/advanced/reduce-latency
- https://developers.jup.ag/docs/api-reference/swap/v1/swap

## Buyer intent contract (not implemented yet)
- Source proof from authenticated on-chain Slingoor/Chairman BUY, not transfer.
- Lock unique (executionWallet,mint) and one of two slots via DB transaction.
- Spend <= $10 USD converted at a fresh independently sourced SOL/USD price,
  AND <= 0.1 SOL absolute.
- Independently validate quote inputMint=wrapped SOL, outputMint=target mint,
  requested raw input amount, slippage cap, maximum priority fee,
  route fee/payer and token decimals; no unreviewed accounts/programs.
- Parse the complete transaction including any Address Lookup Tables; an
  unresolved table means DENY, not accept. Audit all instructions and writable
  accounts, not just program IDs.
- Independently simulate the EXACT transaction bytes to be signed; no mutable
  quote, route or blockhash replacement between approval and signature.

## Manual seller intent contract (not implemented yet)
- Only verified owner Telegram private callback; strong replay protection.
- Sell only tokens held by isolated wallet; independently fetch token account
  mint, owner, balance and decimal unit before sizing 50% or 100%.
- Verify quote inputMint=held token, outputMint=wrapped SOL, exact amount,
  min output, nonzero verified SOL proceeds, route and fees; sign only
  the reviewed transaction.
- Do not confuse 100% of quote amount with all token accounts or withheld
  token amounts. Re-read balance at settlement.
- Partial sell must NOT release a BUY capacity slot. Full sell releases only
  after finalized chain proof, zero remaining position balance, verified
  proceeds and durable sell signature record.

## Execution trust boundary
Alert worker never gets signing secrets or a send-transaction capability.
An independent signer must pull authoritative reservation and policy directly
from trusted storage and independently inspect transaction bytes + fresh chain
state. It cannot trust booleans set by the alert worker. Authenticated
communication requires mTLS or equivalent narrow authenticated service
identity, anti-replay nonce and exact reservation binding.
The trade-transaction fingerprint, signature and expiry must be durably
recorded BEFORE broadcast, and unknown results must be reconciled before
any new attempt. Kill-switch blocks BUY, but permits authorized SELL.
Persistent DB migration not applied. ECHO signer and transport remain hard-OFF.

## Go/no-go evidence
- Proof of control of expected execution wallet by signed challenge.
- Fully audited BUY + SELL transaction builder (v2 or Pump.fun) with real
  read-only simulations and malicious transaction fixtures.
- PGlite/production-staging DB migration tests for simultaneous reservations,
  restart, full-sell slot release and daily cap.
- Owner-only Telegram callback update consumer integration, no duplicate webhook.
- CI, typecheck, provider-load checks, wallet isolation and reversible deploy.
- Separate explicit authorization before any live $10 order.
