# AlphaOS Echo — owner-locked live BUY policy (2026-11-06 14:30 UTC)

This explicit owner policy supersedes *all conflicting earlier draft settings*, including the old maximum-two-position restriction, $500,000 market cap allowance and no-repeat-mint restriction. It is the canonical intended policy for PR #282 / Issue #283. This file is NOT a trading release or deployment approval.

1. **Tracked caller wallets:** Slingoor and Chairman only; independently prove that each genuine source transaction is the tracked wallet's BUY swap, not a gift, incoming transfer, SELL or unrelated signer.
2. **BUY mode:** Automatic after the owner's durable AUTO_BUY_ON switch is enabled. Provide an immediate owner-only AUTO_BUY_OFF toggle for sleeping and an independent emergency kill switch that is checked at coordinator, signer and broadcaster.
3. **Market cap:** Strictly less than $100,000, from fresh independent on-chain/market evidence.
4. **Trade size:** At most $5 USD **all-in for each BUY** including principal, network fee, priority fee, ATA rent and any extra CPI payer debit. Recalculate for fresh SOL/USD. No automatic wallet-wide lifetime spend cap has been requested.
5. **Number of positions:** No fixed count restriction. Wallet-wide reservation MUST still prove remaining SOL covers every pending/unknown BUY debit and independently bounded manual Phantom SELL reserves for **all** open positions. Capital shortage and unknown exit routes must fail closed.
6. **Slippage:** Maximum 10% (1,000 bps).
7. **Price premium:** Never buy above 150% of the verified original caller's execution price.
8. **Repeats:** A *different independently verified on-chain caller BUY source signature* can trigger a new BUY of the same token even while already held. Repeated WebSocket/Telegram notification for the *same* source signature must NOT trigger a second buy. Preserve durable exactly-once source signature reservation and no second submission for unknown results.
9. **Failed/unknown transaction:** Zero automatic retries. Unknown outcome must remain held for reconciliation; no duplicate send, including after process restart.
10. **SELL:** Owner manually sells through Phantom. No auto-SELL.
11. **Security:** Isolated private signing key, authenticated request/nonce, exact instruction/fee/CPI proof, fresh wallet and FX, independent route/exit review, bounded $5 entry, durable auto-BUY off/kill switch, manual sell solvency, explicit separate owner approval before real-money activation.

**State as of writing:** draft preflight and review-only SQL updated, tests amended; not deployed or independently CI verified. The production bot still runs the older alert-only code. Real-funded simulation, full CPI provenance, Phantom SELL and pilot transaction are outstanding.
