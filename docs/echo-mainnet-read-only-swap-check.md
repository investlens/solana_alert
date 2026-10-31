# Real provider-backed Jupiter v2 READ-ONLY swap verification

**No wallet keys or seed phrases required. This command never signs, sends, broadcasts,
calls Jupiter /execute or submits a transaction.** It only calls Jupiter GET /order and
the configured Solana RPC simulateTransaction.

## Prerequisites
- Checkout `fix/echo-unsigned-instruction-guard-20261030`, Node 22+, `npm ci`
- A Jupiter API key (from https://portal.jup.ag/); do not paste it into ChatGPT,
  an issue, screenshot, or a GitHub commit
- A Solana mainnet HTTPS RPC URL; a public URL may be rate limited
- A chosen PUBLIC wallet address (default below: the user's already verified
  Phantom *public* address). It never signs and may be unfunded.

## Run BUY build/simulation against actual mainnet providers

In **zsh** on your own Mac:
```sh
git pull --ff-only origin fix/echo-unsigned-instruction-guard-20261030
npm ci --ignore-scripts
export ECHO_PREVIEW_WALLET='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ'
export ECHO_PREVIEW_MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export ECHO_PREVIEW_RPC_URL='https://api.mainnet-beta.solana.com'
read -rs 'JUPITER_API_KEY?Jupiter API key (hidden): '; echo; export JUPITER_API_KEY
ECHO_PREVIEW_SIDE=BUY ECHO_PREVIEW_AMOUNT_RAW=10000000 npx tsx scripts/echoRealReadOnlySwapV2.ts
```

The 10,000,000 lamport amount here is 0.01 SOL **for diagnostic purposes
only**; it is NOT a live $10 trade and does not establish a USD conversion.
The production $10 sizing requires a fresh independent SOL/USD price and
must remain within 0.1 SOL.

## SELL build/simulation

For an initial USDC route probe (6 decimals; 10000 raw units = 0.01 USDC):
```sh
ECHO_PREVIEW_SIDE=SELL ECHO_PREVIEW_AMOUNT_RAW=10000 npx tsx scripts/echoRealReadOnlySwapV2.ts
unset JUPITER_API_KEY
```
The above SELL will not simulate successfully unless the public wallet has a
suitable USDC balance and the quote is buildable. Never interpret an
insufficient-funds failure as a confirmed executable SELL.

For a real Pump.fun token, replace ECHO_PREVIEW_MINT with its verified mint
and set the SELL amount in that token's **raw base units**, based on an
independently verified on-chain token balance. Do not infer decimals.

## Interpreting evidence

- `outcome: SIMULATED`: Jupiter returned an unsigned v0 transaction; its
  shape passed restrictive validation; Solana RPC returned err:null.
  This is not permission to sign.
- `outcome: NOT_VERIFIED, orderBuilt: true`: the builder generated a validated
  unsigned order and a SHA-256 fingerprint, but RPC simulation failed. A
  `failureClass: INSUFFICIENT_FUNDS_OR_TOKENS` indicates wallet balance,
  not necessarily route failure.
- `JUPITER_API_AUTH_REJECTED`: wrong/missing API credentials.
- `JUPITER_RATE_LIMITED`: provider quota, do not retry aggressively.
- `UNRESOLVED_LOOKUP_TABLES`: route uses ALTs; independent account resolution
  and economic audit needed before the signing design can accept it.
- `UNREVIEWED_PROGRAM` or `NO_UNIQUE_JUPITER_SWAP_INSTRUCTION`:
  restricted validator cannot approve route, even if it is legitimate.
- `RPC_UNAVAILABLE`: RPC endpoint/network problem, not proof of trade safety.

Successful simulations remain provisional: a separate protected signer must
independently inspect wallet and token balance, exact program accounts,
slippage, fees, quote age, atomic reservation, ownership and destination.
The current Echo build has trading permanently disabled and never performs
a live order in these scripts. Do not fund a wallet just to make this
diagnostic pass.

## Evidence to share safely
Only the printed JSON diagnostic outcome (after checking it contains no
credentials). Never share `JUPITER_API_KEY`, private RPC auth URLs, wallet
seeds, or raw signed transactions.
