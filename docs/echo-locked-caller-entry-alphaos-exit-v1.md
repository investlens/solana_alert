# LOCKED — AlphaOS Echo Caller Discovery + AlphaOS Exit Research (2026-10-24)

## Core hypothesis
Follow verified callers for **entry discovery**, not their exits. Test whether AlphaOS's existing dynamic paper trailing-stop captures post-alert price appreciation that callers otherwise give back. This is a hypothesis; not demonstrated profit.

## Boundaries
- READ-ONLY historical research and PAPER replay only. No real orders, keys, trades, enabled automation, or change to PONS/ARC/Robin/main Solana alerts.
- Never overwrite/change the existing trailing-stop logic while evaluating it. Source of truth: `src/echo/signals.ts` `openPaperStop` and `updatePaperStop`.
- Before treating historical signatures as scored, recover caller, verified buy/sell, token mint, alert delivery time, source and chronological token price samples. Missing prices or uncertain execution: unscored.
- Entry reference must be first observable **at or after delivery** (with timing window declared). Include alert latency, fees, liquidity, route execution price, and slippage assumptions. Price-only backtests are hypothetical gross marks.
- Replay prices chronologically; check exit condition against the **existing** stop before updating peak and stop, matching production paper behavior. Stop fills are at the observed executable price or conservative assumption, never assumed guaranteed at stop threshold.
- Distinguish one token opportunity from multiple partial buys/SELLs. Attribute per caller and overlapping callers without look-ahead.
- Outcomes at 5m, 15m, 30m, 1h, 6h, 24h; max favorable excursion, drawdown, realized paper-stop exit and retained fraction of upside; compare caller actual sell if independently verified.
- Candidate winning rules are patterns of **repeatably capturable** returns, not peak-chart screenshots. Use chronological unseen holdout, minimum sample/coverage, downside bounds and caller-wise reporting.
- Do not remove minimal sellability/execution guards from any future real trading.
- 4 current wallets live; extend to 10 only after verified trading-wallet evidence and bounded throughput tests. Research can include 20 candidates. High-frequency wallets research-only first.
- Any live trading, new high-conviction filtering, or public exposure requires separate explicit approval.

## Existing stop tiers — unchanged
Initial stop 20% below entry. From +30% ROI: 15% trail and +10% entry floor; +50%: +20% floor; +60%: 12% trail; +75%: +35% floor; +100%: 10% trail and +50% floor. At +20%: at least breakeven. Calculate exact stop with the existing code, not this description.

## Deliverables
1. Historical observation dataset + source/coverage documentation
2. Offline per-trade price-path replay using existing paper stop
3. Caller × conditions report of winners, recoverable winners, failures, missing data
4. Comparison versus HODL, fixed-time exits and actual caller exits when verified
5. Pattern discovery and out-of-sample validation; only then propose alert rules.

## Clarification locked 2026-10-24 — comprehensive capture before filtering
- Echo is currently in **observational discovery mode**: capture and notify on every confidently attributable BUY and SELL by a watched wallet regardless of valuation, liquidity, age, momentum or performance. The existing 4-wallet Pump/PumpSwap-only decoder is insufficient coverage; it is an implementation constraint, NOT a desired eligibility/quality boundary.
- Expand transaction recognition across verified Solana swap routes (including aggregator routes) with reliable signer/trading authority, token-in/token-out balance deltas and trade intent; never classify transfers, self-transfers, airdrops, fees or balance changes alone as trades without corroborating swap evidence. Ambiguous events go into an explicit UNVERIFIED research bucket rather than being discarded as low quality.
- Distinguish **all verified trade alerts** from **future recommended high-conviction alerts**. No market-quality cutoff or learnable score filters during cohort collection. Dedup distinct trade events; preserve every verifiable action as event evidence, but batch/rate-manage bursts without silently dropping study data.
- Record unsupported/rejected reason and sample signatures privately to quantify missed coverage, while limiting sensitive info in public logs. Repair historical completeness after deploy.
- Only after representative caller observations, post-alert price paths, tiered stop replays, adequate sample coverage and chronological out-of-sample evaluation should we PROPOSE boundaries. Never auto-activate these boundaries without explicit approval.
- Do not modify current live scanner until the expanded parser has fixture-based regression tests against real signatures and a safe Echo-only rollout.
