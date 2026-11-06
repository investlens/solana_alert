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
