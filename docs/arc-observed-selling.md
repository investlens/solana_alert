# ARC-only receipt-backed selling

ARC supports an observed-selling alternative to simulated exits. This route changes only ARC files and the ARC runner. Robinhood, PONS, Solana and shared recipient timing are unchanged.

Requirements: provider honeypot/cannot-sell flags clear, no reported token fee above 10%, exact supported Uniswap V4 plain pool hash (zero hook), token/USDC identity, liquidity at least $2,500, and recent aggregate sells at least four before spending RPC budget. Normal opportunity market and contract gates continue to apply.

Within the last five minutes require four distinct EOA transaction senders, each with successful receipt-backed sells receiving at least $5 USDC, total at least $50, and largest seller at most 60%. Exclude the creator when known. Do not infer unrelated ownership or funding from distinct addresses. Transactions must contain exactly one PoolManager Swap, exact token debit and exact quote credit to the actual transaction sender. Failed, ambiguous, removed, stale, contract-wallet, multi-pool, unsupported hook and mismatched block/transaction evidence do not count. Two head blocks are excluded.

ERC20 USDC uses 6 decimals. Native USDC uses the zero-address pool currency and the system Transfer emitter 0xfffffffffffffffffffffffffffffffffffffffe at 18 decimals. Never sum mirrored native and ERC20 events. Amounts shown are transfer proceeds before gas. Primary reference: https://docs.arc.io/arc/references/usdc-system-events .

Load bounds: one candidate at a time, two starts/minute, last 600 blocks, reject windows above 200 matching swap logs, at most 12 unique transactions, stop starting transaction reads after 25 seconds. Individual requests use the existing RPC scheduler/failover timeout; the final in-progress transaction can extend beyond 25 seconds. Cache at most 100 compact results; positive cache 30 seconds capped at evidence expiry, negative cache 60 seconds. Budget exhaustion withholds and allows retry. No raw receipts are stored or broad chain history ingested.

Observed sells are explicitly not simulated exits and cannot establish that future wallets can sell. The runner displays receipt count, distinct wallets, USDC proceeds, concentration and linked-wallet uncertainty. All ARC feed formats preserve warnings.

V4 protection remains UNKNOWN until exact-pool position lock/burn proof is independently available. ERC20 LP-holder reports are not V4 NFT position proof. UNKNOWN has a prominent protection-unverified warning; UNLOCKED says LIQUIDITY NOT LOCKED. Independently verified LOCKED/BURNED says Liquidity protection verified, never safe.

Live validation on 2026-10-11: public ARC RPC supplied current block, recent Swap logs and successful receipts. GoPlus returned code 5000 (system error) for the checked cofee token; incomplete provider security evidence remains withheld. No qualifying live alert is claimed by these probes. The feature can only release an alert once all applicable evidence requirements pass.
