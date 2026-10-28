# AlphaOS Echo AutoTrader — release acceptance gate

Status: NOT DEPLOYMENT READY. Draft PR #248 is isolated, shadow-only. No production deployment, wallet funding, signing or broadcasting approved.

## Must pass before deployment approval
- Real finalized Pump.fun BUY signatures for Slingoor and Chairman, with trusted RPC evidence.
- Official Pump bonding-curve and PumpSwap account/discriminator validation, token receipts, SOL debit and inner execution evidence.
- Verified per-intent caller/signature/mint evidence joined atomically to reservations; replay and permission tests.
- Isolated database migration, concurrency, rollback, restart, reconciliation and loss-breaker integration tests.
- Admin-only Telegram /autotrader and persistent STOP wired and tested end-to-end.
- Secure dedicated-wallet custody and signer integration independently reviewed; Phantom visibility alone cannot sign unattended.
- Execution quote max 0.1 SOL, 3% slippage, max 2 positions, 0.15 SOL daily realized loss cap, permanent wallet/mint dedupe, manual sell only.
- Branch CI, isolated end-to-end dry run, scope/security review and explicit user approval before deployment.

## Current fail-closed blockers
- adminCallerRpcObserver hardcodes verifiedSwapBuy=false.
- adminPumpV3Evidence returns verifiedBuy=false.
- echo_admin_verified_caller_buy_evidence disallows verified=true.
- adminSignerBoundary is deny-all.
- No production migrations applied.

Green CI is necessary but does not prove live-trade readiness. Do not mark deployable on CI alone.