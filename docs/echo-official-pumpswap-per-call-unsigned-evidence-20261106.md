# Echo official PumpSwap unsigned handoff evidence (2026-11-06)

This branch deliberately avoids production execution. It introduces:
- An exact unsigned transaction SHA-256 fingerprint in `echoOfficialTwoHopQuoteSimulate.ts`, allowing authenticated byte comparison after a real SDK build without printing transaction bytes.
- `src/echo/pumpUnsignedPerCallHandoff.ts` that compares those bytes against an independently audited receipt, SOL debit, verified pool route, token mint, and the **per-source** reservation ID needed for repeat buys.
- Explicit fail-closed rejection of unfunded simulations, provisional ATA rent, unpriced CPI debit, stale FX/wallet state, missing Phantom manual-exit reserve, and unmatched transaction bytes.
- No private key access, signing, broadcasting, prod migration, or new dependency in the production bot.

## Execution-gate limitations
The existing two-hop live diagnostic is **0.025 SOL** (legacy pilot), not a dynamically sized $5 order. Its known SOL transfer plus base fee and ATA upper bound are **not** a complete wallet-debit proof: CPI wallet debits remain unknown. It will reject or fail simulation with the currently unfunded wallet. A missing on-chain success must not be reported as a successful simulation.

The per-call v2 signer currently uses the Jupiter-specific unsigned audit and must **not** consume the PumpSwap result until the signer has its own independently audited Pump program instruction and CPI semantics, durable nonce, and exact real-world transaction simulation. `pumpUnsignedPerCallHandoff` returns review-only with both execution switches false.

## Latency evidence
Instrument (a) observed whale source BUY chain slot, (b) monitor reception, (c) verified swap/quote, (d) atomic source-signature DB reservation, (e) isolated signer review, (f) actual one-shot send. Synthetic no-broadcast tests cannot establish 1–3 seconds in production, and the previous 0.025 SOL diagnostic is not a $5 price quote.

## Release gates remain
- Independently verified recovery of actual production Echo and Supabase project before migrations.
- Verified exact $5 all-in SOL ceiling and actual funded-state unsigned PumpSwap simulation.
- Independent Pump program/CPI route audit and Phantom SELL network reserve.
- Owner-authorized real wallet signer dry-run that destroys signed bytes, real monitor-to-signer no-broadcast path and measured p95 latency.
- Explicit separate approval for any live wallet funding, signing or broadcast.

No deployment or funds are authorized by this evidence file.

## Actual bounded mainnet diagnostic evidence — 2026-11-06

Read-only GitHub Actions job: https://github.com/investlens/solana_alert/actions/runs/42159931550

- SDK: `@pump-fun/pump-sdk/swap@4.3.1` — two pool accounts verified; 6 unsigned instructions.
- Legacy input: `25,000,000` lamports (0.025 SOL), **not** a $5-sized order.
- Expected output raw: `9560405783527`; fee-aware minimum raw: `8604365205174`.
- Exact unsigned SHA-256: `5959da4c71ea02af134838cb8baf1481abb4df72d85c0bc7bf53613ce2d055d9`.
- Base fee returned: `5,000` lamports; 2 absent token accounts; conservative rent for each: `5,852,160` lamports.
- Known (incomplete) debit floor: `25,005,000` lamports; provisional total including ATA allowance: `36,709,320` lamports (0.03670932 SOL).
- Observed execution wallet balance: `0` lamports. The diagnostic stopped with `INSUFFICIENT_PROVISIONAL_BALANCE` **before** `simulateTransaction`.
- CPI and full wallet debit independently verified: **NO**. Manual Phantom SELL reserve: **NOT ESTABLISHED**.
- Simulation passed: **NO**; signatures created: **NO**; broadcast: **NO**.
- Total read-only RPC requests: 8.

This evidence proves the unsigned SDK build and a partial cost estimate, not a completed $5 real-wallet BUY. The exact fingerprint is **necessary but insufficient** for signer-side admission: unsigned bytes must independently be furnished through an authenticated private channel and inspected against a funded-state simulation, complete CPI accounting and the immutable per-call reservation.

## November 6: conservative funding gate and offline signer bridge

- `src/echo/pumpFundingReadiness.ts` reports separately (a) the provisional lamport floor for **attempting** the already-built unsigned message and (b) a complete requirement *only when* wallet CPI bound, manual-SELL reserve, pending debits and fresh SOL/USD are independently known. It does not authorize funding. The historic 25m-lamport unsigned diagnostic still has a **36,709,320 lamport provisional floor**, with the real wallet at zero.
- This prior fixed 0.025 SOL test is **not a $5 BUY**. At deployment the SOL principal must be recomputed using the current rate and all-in costs, then the exact quote and unsigned bytes rebuilt.
- `src/echo/pumpPerCallSignedDiscard.ts` is an isolated authenticated PumpSwap review-to-signature-discard bridge: the pinned Echo signer must independently prove a complete trusted quote+fee+simulation+DB reservation, then sign only the exact serialized message; verified signature is discarded without RPC submission.
- Synthetic tests cannot prove control of the real Phantom trading wallet and do **not** count as the real-wallet signing acceptance. Do not send or store a key in GitHub, logs or this chat.
- The existing RPC simulation has **not passed against the actual 0 SOL wallet**. Wallet funding and live sign/send remain separately prohibited. No current claim of 1–3-second observed whale-to-RPC submission latency is supported.
- Independent full Supabase recovery and the production per-call schema migration remain distinct release blockers.
