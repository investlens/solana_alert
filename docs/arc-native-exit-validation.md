# ARC repair validation — 12 October 2026

Read-only public-provider validation of the exact native-USDC DOGCOIN pool completed same-wallet buy/full-sell at $10/$100/$500, with 0.49% maximum round-trip loss excluding gas. No transactions were signed or broadcast. Only each random test wallet native balance was overridden; token, router and pool state were unchanged. Exact pool hash was verified for fee 2500, tick spacing 50 and zero hooks.

Official ARC deployment reference: https://docs.uniswap.org/contracts/v4/deployments . The deployed ARC Universal Router decodes the minimum-hop-price field in ExactInputSingleParams. The former omitted field caused the bytes offset to become the minimum price, producing V4TooLittleReceivedPerHopSingle. The new native verifier uses the validated ABI. Provider documentation: https://www.quicknode.com/docs/arc/eth_simulateV1 .

A second live pool (SLUDGE) returned no bought tokens. StateView independently reported zero active liquidity while DexScreener still showed approximately $31k. This is not labeled a honeypot; automatic approval remains withheld.

Limits: one active simulator, two starts/minute, six simulations plus chain/head reads per candidate, one 25-second deadline, one block snapshot, bounded 100 KiB RPC replies, 100 cached compact results. Unknown hooks, unsupported quote routes, incomplete funding/settlement, residual tokens, confirmed reverts and loss above 10% cannot pass. Native validation is never presented as liquidity lock or future execution guarantee.

The ARC worker can run one explicitly configured read-only startup check against its privately configured endpoint. All candidates require their own current evidence. Confirmed restrictions and known excessive taxes block before simulation or receipt fallback. Missing tax/full-sell data can reach exact receipt settlement only, with explicit uncertainty on cards.

Pending genuine boosts are stored in a maximum-100-entry, 30-minute recovery queue; unknown initial feed totals remain silent baselines. Per-recipient durable claims protect accepted sends during partial delivery failures and restarts.

The existing shared outcome timer uses ARC evidence for ARC milestones, and performs at most one extra rotating active-token market check per minute. It preserves checkpoint outcomes and does not claim continuous lifetime ATH coverage.
