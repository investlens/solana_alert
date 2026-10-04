# Approved Robinhood launchpad policy

Approved origin routes: **PONS V1, PONS V2, Flap** on Robinhood mainnet (4663).

- PONS: exact token plus approved factory provenance using the existing registry/index/event resolver.
- Flap: exact token read from the official Robinhood Portal `0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09`, using `getTokenV7`.
- Flap `Tradable` (1) and `DEX` (4) states qualify. Invalid/staged addresses are not completed launches; obsolete duel/killed states explicitly cannot sell and do not receive an exemption.
- Never approve from token name, symbol, vanity suffix, social links or provider metadata alone.

Once origin qualifies, **no separate honeypot, LP-lock or liquidity-security provider check** gates Boost, DEX Paid or the shared positive-alert security path. All remaining feed criteria (including confirmed fresh DEX payment, momentum/creator criteria and feed-specific scope), preferences, dedup and delivery timing remain unchanged. This does not turn PONS-only feeds into all-launchpad discovery feeds.

Cards say verified **origin**, not risk-free or guaranteed sellability. Creator holding, top-10 concentration, stats and unavailable-data disclosures remain. Flap supports taxed tokens; approval is not a profitability or tax-free guarantee.

Flap provenance reads are on-demand, bounded to two existing Robinhood RPC endpoints (8-second primary budget, 2-second fallback), coalesced and cached in a maximum 500-entry process cache. No new poller, SQL table, discovery persistence or historical log scan is introduced. Unknown/custom/other-chain tokens retain existing security gates.

Sources:
- https://docs.flap.sh/flap/developers/deployed-contract-addresses
- https://docs.flap.sh/flap/developers/wallet-and-terminal-and-bot-developers/inspect-a-token
- https://github.com/ponsdotdev/pons-labs
