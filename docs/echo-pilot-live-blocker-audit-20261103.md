# AlphaOS Echo production acceptance audit — 2026-11-03
Status: **NOT READY / DO NOT FUND / DO NOT ENABLE AUTO-BUY**.
Scope: isolated PR #279, never main AlphaOS production, no key export, signing, RPC broadcast or trading.

## Verified evidence
- Dedicated real-wallet off-chain ownership challenge: Railway isolated signer deployment `5216b88c-629a-4be6-ac18-0cefe08991ff` logged `ECHO_ISOLATED_CUSTODY=VERIFIED;TRADING=OFF`. **This is not a signed BUY**.
- Official Pump SDK two-hop unsigned **build** succeeded in Actions `41506082421`; quote and build succeeded in `41507294334`.
- The latter CI job `echo-official-two-hop-quote-sim` **failed**: `simulationPassed=false`, `unitsConsumed=0`, `additionalFeesFullyVerified=false`. Root cause not proven. Historical test mint is not eligible for pilot auto-buy.
- Existing production `public.echo_live_buy_intents` has **zero rows** and primary key (execution_wallet,mint). Read-only DB query confirms `echo_pilot_capital_ledger`, `echo_signer_used_nonces`, `echo_pilot_reserve_all_in_atomic` **absent**.
- In PR #279: latest isolated diagnostic rejects known-insufficient wallet balances ahead of unsigned simulation; no value from this diagnostic alone certifies a maximum wallet debit.
- PGlite fixture tests cover two-slot/duplicate/capital behavior; they do NOT establish live Postgres concurrent-client or restart safety.
- Read-only manual wallet-app SELL verifier exists, but no independently checked finalized real Phantom SELL or production slot-close path was observed.

## Complete funding equation (must be independently proven with exact audited transaction)
`required_wallet_lamports = 25_000_000 swap input + getFeeForMessage(exact message) + funded account creation rents + any wallet-funded CPI transfers/rents not represented as top-level system transfers + fee/exit safety reserve + sum of other pending commitments`.
Avoid double-counting Solana fees or wrapped SOL transfers. Validate actual pre/post-wallet SOL and token account balances from a successful simulation; include priority fee in exact message fee and compute-budget account inspection. The 1024-byte ATA rent query provides a *provisional estimate*, not a complete debit bound. Convert to USD with an independently sourced current SOL/USD price and enforce <= $10 all-in entry and <= $30 lifetime committed cap. No exact funding amount is authorized until all terms are independently known.

## Ordered acceptance
1. Fresh real caller BUY & market cap < $100k, <= 50% verified caller-price premium, matching continuous canonical pool/curve route, independently proven manual sellability.
2. Decode exact unsigned message, all programs/CPI accounts, payer, ATA owners, approved mints, compute-unit price/limit; independently determine complete maximum debit and exit reserve. Fail closed on unknown costs.
3. Reconstruct and successfully simulate the exact unsigned BUY against actual dedicated wallet state. A zero-unit or balance failure is NOT a pass. Do not substitute synthetic funded simulator state as proof.
4. Verify recoverable, tested Supabase backup and ordered migrations (base already exists; two-slot -> all-in ledger -> one-shot submission -> nonce journal). Check RLS/GRANT, legacy RPC access, migration idempotency, concurrency across distinct database clients, process restart/unknown outcome.
5. Authenticated one-use nonce + real DB reservation + independent quote audit -> real isolated-wallet message signature -> verify then discard without broadcasting. No private key or signed bytes in logs/chat.
6. Confirm Phantom controls exact same wallet, independently validate unsigned SELL route, then after separately approved tiny mainnet buy demonstrate finalized manual full SELL and independently verified zero remaining token balance before DB slot-close.
7. Read-only caller-to-eligible-BUY pipeline plus measured latency, no false transfer alerts, no duplicate, no trade submission. First real mainnet buy and unattended auto-buy both require separate operator approval.

## Release controls
Keep `ADMIN_TRADING_ENABLED=false`, `ECHO_SIGNED_BUY_DRY_RUN_BROADCAST_ENABLED=false`, `ECHO_ONE_SHOT_HANDOFF_BROADCAST_ENABLED=false`. Do not deploy revised signer, apply production DDL without backup, request wallet funding, or send transactions merely to clear a test.
