# Boost and DEX-paid policy — version 2026-10-13.1

Applies to Robinchain and ARC promotion events. It does not change ordinary opportunity or burn rules.

| Evidence | Decision |
|---|---|
| Exact token verified against an approved PONS factory | Immediate promotion delivery; no custom sell/LP gate |
| Confirmed honeypot or sell restriction | Block |
| No reported sell activity, or missing sell activity | Watch; zero sells alone is not a honeypot diagnosis |
| Selling cannot be verified | Watch and bounded retry |
| Selling verified, LP unlocked | Deliver with **LIQUIDITY NOT LOCKED — owner can withdraw liquidity; high rug risk** |
| Selling verified, LP protection unknown | Deliver with **LP LOCK NOT VERIFIED** warning |
| Selling verified, independently verified LP lock/burn | Deliver and disclose verified protection; never promise complete safety |

PONS origin is exact-contract factory evidence, never a name or symbol. Missing creator enrichment cannot invalidate an existing verified factory proof. Other launchpad names do not grant the PONS promotion exemption.

For custom tokens, simulations must prove the same wallet's buy and full sell in the exact displayed pool. ARC may alternatively use its existing independent-wallet receipt-backed sale requirements. Provider flags by themselves are not exit proof. Volume, token age and developer holding are not added entry thresholds for these promotion events.

New boost purchases and genuine increases remain repeatable. Startup/reconnection snapshots and unchanged totals do not become fictitious new purchases. Unknown evidence stays on bounded watch/retry; recipient leases prevent replay after ambiguous Telegram sends.

Admin/Pro/free release delays remain 0/5/30 seconds. Solana remains paused. Global latest/top provider lists are bounded; upstream omissions or outages must not be represented as guaranteed worldwide coverage.

Regression matrix: `tests/promotionAlertPolicy.test.ts`. Runtime enforcement: Robin promotion security router and ARC promotion delivery policy.
