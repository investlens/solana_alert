# Alert data coverage — 2026-10-02

Running services do not imply complete data coverage. Sources must identify the exact chain and base token. Missing values are unknown; zero trade counts and volume are valid only when the provider explicitly supplies zero.

| Field | Available source | Current limit |
| --- | --- | --- |
| Price | DEXScreener exact base pair; verified PONS public-page quote | Pre-bond page snapshot is labelled separately; not an executable fill |
| Market cap | DEXScreener reported MC | Missing before indexing for many tokens; never substitute FDV |
| FDV | DEXScreener; verified PONS quote × total supply | Display as FDV, separately from circulating MC |
| Liquidity | Indexed DEX pair | Curve reserves are not labelled LP liquidity |
| Volume | DEXScreener 5m/24h | Only display returned periods; missing is not zero |
| 1h movement | DEXScreener priceChange.h1 | Unavailable without indexed trading history |
| Total supply | Verified PONS page; existing ERC-20 metadata readers | PONS supply is added to requested reports; general supply enrichment remains pending |
| ATH | No complete-history source verified | PONS outcome collector has sampled observed peaks; do not label ATH |
| Creator holding | Existing same-block on-chain evidence | Only render verified values; a creator address alone is not holding evidence |
| Top 10/fresh/insider wallets | Partial existing holder evidence | Full ranked ownership and freshness coverage not verified |
| Security | Existing contract/LP evidence per strategy | Requested report explicitly says risks not assessed; ARC market checks are not a contract audit |
| 24h fees | No verified source integrated | Do not estimate fees from volume |
| DEX Paid | Existing paid-event path where supported | Boost quantity is not payment evidence; not added to requested report without proof |
| Socials | Token/PONS/DEX metadata | A link is not ownership proof; Social Mafia retains exact-CA confirmation gate |

Requested reports use a 30-second memory cache, 50-report maximum, three distinct in-flight reports and ten uncached requests per minute. Requested scans first look for a verified factory marker or an exact-token census record (one-second database deadline). When neither exists, exact-token metadata from the public PONS page may still be shown with an explicit PONS-page source; this does not establish launch provenance or social ownership and does not change automatic alert eligibility. Creator balance, when returned, uses same-block on-chain reads with a four-second total deadline and no retries. Missing balance is omitted. Refresh replaces the original photo/caption and bypasses the report cache while preserving upstream market caching and lookup limits. Images and public HTML are temporary memory data, not database payloads.

PONS outcomes sample at most 50 recent tokens per five-minute cycle, one market request at a time. The recent candidate window is capped at 500 and logs incomplete coverage if reached. Historical prices that were never captured cannot be reconstructed from a current quote. Per-alert delivery/decision correlation and ARC performance history remain pending.


Address research supports Robinchain and ARC only. `/scan <0x-address>` and bare addresses in private chats resolve indexed token matches first; otherwise chain-verified RPC account facts are checked. Ambiguous addresses or unavailable chain checks show a chain selector rather than guessing. `/scan robinhood <address>` and `/scan arc <address>` remain explicit options. Groups require administrator `/scan_on` (24-hour memory opt-in); this does not enroll members in alerts.

Creator-address links open bot wallet research. Native balance and transactions sent are chain-verified RPC facts, with a four-second deadline and no retries. Creator history reads at most 21 rows from each existing launch source and reports the latest 20 merged tokens, with at most three displayed. Outcome lookups are limited to those tokens, with a shared 2.5-second database deadline. Peaks are sampled observed peaks; current market caps are labelled last MC with their observation time. No missing history is treated as safe, no sells/transfers/burns are inferred from balance, and no full portfolio balance is claimed. Research is bounded to three distinct lookups, ten uncached lookups per minute, 100 temporary report entries, and a 15-second chat cooldown; no new database writes or services.
