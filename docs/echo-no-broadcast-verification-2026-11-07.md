# Echo $5 all-in no-broadcast verification — November 7, 2026

This file records a **single explicit read-only GitHub Actions trigger** for the `echo-isolated-signer-real-rpc` diagnostic. The commit carrying it deliberately contains `[echo-isolated-test]`; normal subsequent commits do not trigger the job.

## Scope
- Dedicated wallet public address: `8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ`.
- The job builds a pinned official PumpSwap SDK unsigned scenario on a disposable GitHub runner; any real-RPC simulation is only provisional.
- The runner does **not** load the sealed Railway wallet key; its contract explicitly prohibits signing, broadcasting and trading. The running Railway signer is a separate custody-proof-only script.
- The currently configured scenario may be hard-coded to historical example mints and may fail against current pools; such failure means no trading approval.
- A successful receipt, pool verification or read-only simulation cannot prove independently bounded total CPI/rent, exact $5 all-in pricing, Phantom manual SELL execution or unattended signer readiness.

## Acceptance evidence required after run
1. Official SDK installed at precisely pinned version.
2. Source pools, executable instruction and wallet exact unsigned hash verified from fresh RPC.
3. Real wallet funded-state simulation successful, with full network/priority/ATA/rent and CPI budget, plus reliable SOL/USD. A missing funded wallet **blocks this item**.
4. Full Phantom SELL receipt/quote and independently reserved pre-sale SOL.
5. Authenticated signer signed-but-discarded test in the *sealed-key Railway boundary*, owner switch OFF/ON tested with durable DB/nonce; no actual live send.
6. Separate owner approval before deploying any executable broadcaster or submitting one $5 all-in live purchase.

Do not fund, migrate production database, expose secrets, deploy or change the live Telegram alert service based solely on this diagnostic.
