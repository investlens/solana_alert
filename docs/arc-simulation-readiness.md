# ARC simulation readiness

The production ARC service remains on d257e4e (provider recovery). Observed-selling alerts still require complete provider checks. No missing security result is treated as clear.

2026-10-11 validation: QuickNode's documented public ARC demo answered chain ID 5042 and eth_simulateV1. The native-USDC funding test passed: overriding a test EOA to 100 native USDC produced an ERC20 balance of 100,000,000; a simulated 1 native USDC transfer left 99,000,000 at the sender and 1,000,000 at the recipient. Only test EOA native balances were overridden. No signed transaction was broadcast.

This proves provider capability, not any token's security or sellability. The public demo is not configured as a production endpoint. A dedicated ARC endpoint must pass this probe and real-pool same-wallet buy/full-sell validation at $10/$100/$500 before enabling a simulator fallback. Unknown hooks, unsupported pool identity, incomplete/reverted simulations, full-sell residual tokens and excessive loss must remain blocked. Native-currency V4 pools need their own validated router value path; the earlier ERC20-pool prototype does not establish support for those pools.

Run: ARC_SIMULATION_RPC_URL=<privately configured endpoint> node --import tsx scripts/checkArcSimulationRpc.ts . The script prints capability results, not the endpoint. Credentials stay in secret configuration. This probe is not invoked by the live runner and does not enable alerts.

Primary provider documentation: https://www.quicknode.com/docs/arc/eth_simulateV1 .

Ordered rollout: finish ARC independent exit verification first; then expand Solana; then Base. The existing Solana Pump.fun/PumpSwap worker already checks mint/freeze authority and sampled ownership but explicitly says exit quote and linked-wallet risk are not checked. It is not full Solana coverage and must not be enabled as though every agreed security check passed. No Base integration is claimed by this patch. Other-chain code and alert timing are unchanged.
