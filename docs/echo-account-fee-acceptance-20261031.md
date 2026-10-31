# Echo account and fee acceptance gate (2026-10-31)

Status: **NOT APPROVED FOR SIGNING, BROADCAST OR DEPLOYMENT**.

## Verified live provider evidence
The mainnet read-only diagnostics in `docs/echo-mainnet-probe-evidence-20261031.md`
returned Jupiter error code 1 for both requests:
- BUY (SOL to USDC): OKX router, input-wallet funds unavailable.
- SELL (USDC to SOL): Dflow router, input-wallet tokens unavailable.
No unsigned swap transaction was produced, no RPC simulation ran,
and no actual swap-related account or fee evidence was obtained.

## Isolated transaction review work
`src/echo/readOnlyTransactionAccountAudit.ts` analyzes independently
supplied unsigned v0 transaction bytes and resolves lookup table accounts
through an injected read-only RPC lookup provider. It collects:
- Static and ALT-loaded writable and readonly account addresses
- Invoked programs and unknown programs requiring independent decoding
- Compute-unit limit and compute-unit price
- Estimated maximum priority fee and a non-authoritative signature fee estimate

It rejects malformed envelopes, unexpected fee payer, unknown lookup
tables, deactivated tables, direct SOL transfers, compute-budget ambiguity
and excessive priority-fee requests.

This is **code and fixture testing**, not a successful Jupiter mainnet
route review. An acceptable transaction must independently verify token
account ownership and mint, route program behavior, input and output token
balance deltas, swap minimum-output constraints, rent-exemption costs,
actual transaction fee from RPC, fee-payer balance, quote age and expiry.
No client-produced flags can replace these checks.

## Next actionable evidence
Use an **already-funded, explicitly authorized public test wallet** or a
controlled local Solana validator with known token accounts. Do not use
another person's wallet as an implied authorization, do not ask for or
provide private keys, and do not fund Phantom solely for this diagnostic.

Run the read-only Jupiter BUY and SELL diagnostics once with independently
verified token decimal amounts. Only after both builders return actual
unsigned bytes can their specific accounts and fee/rent economics be audited.

## Guardrails
- BUY economic principal: $10, subject to independent SOL/USD conversion,
  0.1 SOL absolute cap, and fee reserve
- Two simultaneous positions maximum, three daily orders, lifetime
  duplicate-token prohibition
- SELL: owner-only manual 50% / 100%; no auto-sell
- All submissions, signing keys and production database changes are OFF.
