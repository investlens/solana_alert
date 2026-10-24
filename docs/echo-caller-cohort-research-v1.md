# AlphaOS Echo — Caller Cohort Research v1 (2026-10-24)

Purpose: discover **post-AlphaOS-alert** winning and losing patterns, not chase influencer popularity.
No trading or auto-selection changes are authorized by this registry.

## Cohort policy
- Target: 10 active, 10 reserve candidates; start with four existing active wallets.
- Add only after verifying exact Solana **trading** wallet using direct profile/activity and transaction-signer evidence; a Pump.fun profile address is a candidate, not necessarily proof that this address executes swaps.
- Validate recent activity, Pump/PumpSwap compatible swap sampling, and unique wallet ownership; no guessed wallet addresses.
- Ramp: 4 -> 6 -> 10 wallets with one Echo Railway service and one replica; bounded RPC and 60-second reconciliations. Monitor transaction throughput, noSignal rejection distributions, queue depth, Telegram errors, reconnects.
- Keep caller callouts and on-chain BUY/SELL independent event types; correlate by caller + mint, and dedupe by callout ID or signature, never just by mint.
- Scores must use **observable prices after Telegram delivery** (5/15/30/60 minutes, 6/24 hours); compare median, downside, sample coverage, and multi-caller overlaps; prohibit look-ahead leakage.
- Use chronological holdout on later calls. No new live filter, risk-score threshold, or auto-trade until independently validated and approved.
- Sample sizes are critical; peak 2x hit rates, creator rewards, and personal realized profits are not follower net returns.

## Active monitored wallets (existing Echo settings; unchanged)
| Caller | Wallet | Status |
|---|---|---|
| Cupsey | 6DQAGJT7VZPVBsuG4kn3AvpyHCEi7B2RFFvMZdbqQqqP | active |
| Thedetective | 6qudAN2kV8mtCcYJxb5QQ6Vr15itdHHdeVbYm99NKMhy | active |
| Croakie | 7fEXteaTtmX1uR8fpChEXsevM4icH5vq8LNL9dzDupX2 | active |
| Chairman | Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6 | active |

## Priority verification queue (NOT connected)
| Caller | Public evidence | Possible profile address | Status |
|---|---|---|---|
| ely | https://pump.fun/profile/CE44oKS3wpUerx8afyeii56u5oQjBLZknzm4Q2CYHUz9 | CE44oKS3wpUerx8afyeii56u5oQjBLZknzm4Q2CYHUz9 | Profile resolved; signer/trading attribution unverified |
| Schoen | https://pump.fun/profile/schoen | 5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM | Profile resolved; signer/trading attribution unverified |
| Dior | https://pump.fun/callouts/FGkCj28xhabWTYg9QyzACvs4NsN6LUyesP6EwiHepump/32ad9a98-5558-46cc-acb3-3e2b2d32715b | Not verified | Public callout; wallet unverified |
| sadcrissy | https://pump.fun/callouts/8M8hAuusNmKg6dEwCr7cHmHcaBwdJbPDxM5vEGAapump/03cfd51f-3379-4950-8907-89e710b4b6ca | Not verified | Public callout; wallet unverified |
| Sheep | https://callcast.org/ | Not verified | Reported closed-trade candidate; wallet unverified |
| notdecu | https://pump.fun/leaderboard | Not verified | Reported trader leaderboard candidate; wallet unverified |

## Reserve candidates (identities only; pending current evidence and wallet match)
slingoor, chester, Zrool, cooker, rambo, ferre, ogantd, hdegroot, alphaprophet, slidrrz.

## Data collection acceptance criteria
1. Capture one research event per accepted Echo Telegram delivery: signature, mint, caller, direction, trade timestamp, delivery timestamp, message ID.
2. Recover older signatures from Railway logs; preserve whether trade timestamp and mint were independently resolved.
3. Acquire deduplicated historical per-token/pool price observations. Store source, timestamp, and coverage. Missing price != zero return.
4. Produce post-alert price outcomes; avoid mixing CALL and BUY and avoid claiming paper gross prices are executable P&L.
5. Evaluate candidate signals and rank only on sufficient measured data, with later holdout period.

## Baseline recorded at planning
Echo deployment f3a4ef75acb3ed9292dd74b4934a6a4173955de8 confirmed SUCCESS at planning.
Existing research script: scripts/researchEchoOutcomes.ts.
No new wallet activated by this file.

## Candidate wallet verification — 2026-10-24

- **Schoen — address corroborated, not activated:** Pump.fun public profile resolves to `5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM`; independent KOL Brain and uwuu.ai attribute trading history to the same address. Sources: https://pump.fun/profile/schoen ; https://kolbrain.fun/brains/schoen_xyz ; https://uwuu.ai/trader/5hAgYC8TJCcEZV7LTXAzkTrm7YL29YXyQQJPCNrG84zM . KOL Brain reports extremely frequent trading (2,655 trades/7 days at its update) and low copyability (4/100); do not forward every trade to the admin chat or increase live RPC load without a bounded research-only sampler and successful throughput test. These figures are external and time-dependent, not independently backtested AlphaOS returns.
- **ely — public identity confirmed, trade-signing address not independently proven:** Pump.fun profile `CE44oKS3wpUerx8afyeii56u5oQjBLZknzm4Q2CYHUz9` shows username ely and X ProofOfEly. Source: https://pump.fun/profile/CE44oKS3wpUerx8afyeii56u5oQjBLZknzm4Q2CYHUz9 . Remains research candidate, not active wallet.
- **Activation gate:** confirm recent successful transactions signed by identified wallet using targeted RPC/explorer sample, verify supported Pump/PumpSwap instructions and realistic per-minute event rate; add only with bounded per-caller tracking, persistent dedup, and initial research-only alerts disabled for high-frequency wallet. No duplicate Railway services. Do not change existing four wallets on the strength of a profile page alone.
