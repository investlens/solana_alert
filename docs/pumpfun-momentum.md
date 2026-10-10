# Pump.fun Momentum Watch

Runs inside the existing main bot when `PUMPFUN_MOMENTUM_ENABLED=true`.
Does not enable the legacy RUN_SCANNER or automated trading. Robinchain,
ARC and winner rules remain unchanged.

## Coverage and cost

One free PumpPortal creation/migration socket replaces the legacy creator-only
socket on this service. At most 40 early creations occupy the candidate queue;
DEX profiles and migrations can fill remaining slots. Queue total is 120;
entries expire after one hour. Capacity skips are logged. Discovery is bounded,
not a census of every Solana launch. No raw creation/trade rows are persisted.

DEX market reads are batches of at most 30 addresses every 30 seconds, at
BACKGROUND priority behind other feeds. Profile discovery runs every two minutes.
Only up to two qualifying candidates per cycle trigger deeper RPC checks. RPC
failures back off for one minute. Only delivered events produce compact audit
rows through the existing delivery path. Images stay in memory.

This first production path covers Pump.fun tokens already migrated to PumpSwap,
quoted in wrapped SOL. Pre-bond curves, other quote mints, mayhem mode, unsupported
mint extensions and unverified/missing evidence are not eligible. No paid trade
stream is subscribed. PumpPortal trade data currently requires a funded API key;
this implementation does not create a wallet or spend SOL.

## Eligibility

- Exact Solana base mint, PumpSwap pool and WSOL quote identity.
- Required numeric market fields present and mutually consistent; never fill
  missing data with zero or substitute FDV for market cap.
- Pair age 2–60 minutes; at least three earlier nonoverlapping observed five-minute
  volume windows are retained. This needs at least 15 minutes of observation.
- Current five-minute volume >= 2x average of those earlier observed windows;
  baseline >= $100, current volume >= $1,000, LP >= $5,000.
- Positive five-minute move, plus rising observed price across two checks spaced
  20–90 seconds apart. >=20 buy trades, >=1 sell trade, buy/sell count ratio >=1.5.
  Counts are trades, not unique or independent wallets, and not buy/sell USD value.
- Pump-owned bonding-curve PDA and PumpSwap-owned pool with matching mint,
  quote and creator-fee wallet. Require completed curve.
- Disabled mint and freeze authority; standard SPL or supported Token-2022
  metadata extensions only. Other extensions fail closed.
- Current confirmed creator-fee wallet balances <=5% of supply.
- Ten largest sampled owners <=25%, aggregating the largest-account sample and
  excluding verified pool base vault/curve owner. This is not a complete holder
  census. A fee recipient is not proof of launch signer or wallet independence.

DEX recent sell counts are provider evidence, not a position-sized exit quote.
Cards explicitly disclose that exit quotes and linked wallets are not checked.
No profit or safety guarantee. Thresholds are initial screening rules, not
historically demonstrated predictive performance.

## Delivery and controls

SOLANA_PUMPFUN_MOMENTUM is default ON in Alert Preferences, grouped under
Solana / Pump.fun. Uses all eligible started users, their capabilities, preferences
and existing Free/Pro timing. Per-recipient Redis claims use mint/event identity
and a 24-hour TTL, protecting against restart/replica duplicates; unavailable
claims fail closed. No silent fallback to an admin-only message.

Inspect `[PumpMomentum] STARTED`, `FREE_DISCOVERY_CONNECTED`, `RPC_READY`, and
`CYCLE` counts/reasons. `RPC_UNAVAILABLE`, `EVIDENCE_UNAVAILABLE`, incomplete
baselines or capacity skips must not be described as full functioning coverage.
