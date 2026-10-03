# AlphaOS data and delivery validation — 2026-10-03

## Product navigation

Home: Alerts, Intelligence, Wallets, Trader Tools (ordinary users), Settings, Free / Pro, My Monitors (where enabled), How to Use, Scan.
Trader Tools explains Scan → Robinchain Readiness → Monitor 1h, supported indexed USD pools, and separate PONS pre-bond curve estimates. Personal monitors remain private-chat tools. Requested wallet research uses research access, consistent with the Free guide; creator outcome/advanced intelligence access remains separate.
Alerts opens preferences and the available recorded setup list. The setup list is not all discovery feeds. Reads of the latest opportunity list have a 2-second database timeout.

## Data coverage

| Field | Source and practical limit |
|---|---|
| Price, MC or FDV, liquidity, volume, 1h movement | Chain/token-matched DexScreener pool snapshot; MC and FDV remain distinct. Requested Full Intel now includes available 24h volume and signed 1h movement. |
| Total supply | ERC-20 decimals/totalSupply reads, chain-verified; PONS page/on-chain context for PONS. Full Intel has the bounded on-chain fallback when metadata is partial. |
| Creator balance | Verified/reported PONS creator context plus on-chain token balance; zero is valid data. |
| DEX payment | Governed DexScreener orders lookup in requested Robinchain Full Intel, with stored observation fallback. Payment is promotion evidence, not token security. |
| Peak / ATH | AlphaOS can show verified observed peak and its source/time. Complete lifetime ATH is not established. |
| Top 10 / holder concentration | Existing holder indexer lookup. Blockscout HTTP 403 can prevent the holder sample; no invented values or zero fallback. |
| Fresh wallets | Existing sampled-wallet nonce-at-cutoff analysis, shown only with sufficient classified coverage. Missing holder sample prevents this analysis. |
| Contract security / sellability | Not established by the requested market snapshot or DEX payment. Existing feed security policies remain unchanged. |
| 24h fees | No verified fee source in the existing integration. Do not estimate fees as volume multiplied by an assumed fee. |
| Socials | Valid metadata links; absent socials shown compactly. Social Mafia additionally needs contract publication evidence. |

No additional background market/holder scans or database tables. Requested Full Intel analysis is capped at two simultaneous tokens and ten new analyses per minute. Existing provider governor/cooldowns, in-flight deduplication, and cache apply.

## Live delivery evidence

The real recipient roster inspected on 2026-10-03 contained one operator and nine Free users, with no current paid members. The observed Boost cycles had four unchanged totals and sent no new alerts. These cycles establish that the observer runs, not that a new Free/Pro alert was delivered.

Each actual Telegram API acceptance now logs AlertDeliveryTiming TELEGRAM_ACCEPTED with a common alert start time, accepted time, elapsed milliseconds, plan release delay, source identity, and deadline check. No recipient IDs or extra database rows are added. Reuse existing send-success boundaries, including sent-unconfirmed accounting; a scheduled timer is never logged as acceptance.

To complete live acceptance validation, observe a genuine qualifying new event and compare its operator and Free acceptance timestamps. Pro remains test-validated until an actual eligible member exists; do not create fake paid accounts or send fabricated production alerts. Telegram API acceptance does not prove handset notification arrival.

## Remaining provider-dependent gaps

Accessible holder/history indexing, complete price history for lifetime ATH, verified 24h fee accounting, and broader ARC deep intelligence remain incomplete. Do not bypass provider restrictions, remove evidence requirements, or label unknown security as safe. Confirm accessible coverage and costs before adding another provider.
