# ARC native-USDC exit validation — deployment hold

This change is prepared only. Do not enable `ARC_CUSTOM_EXIT_SIMULATION_ENABLED` or merge/deploy the draft until a real-pool round trip passes on the intended production RPC.

The public mainnet RPC returned JSON-RPC -32601, `method not supported: eth_simulateV1`, during the 2026-10-11 check. Timeouts also occurred on basic reads. Mocked tests validate request construction and rejection paths; they do not prove real execution.

## Required validation

1. Configure an authenticated ARC mainnet RPC supporting `eth_simulateV1` in `ARC_RPC_URL` on the existing `arc-live` service. Leave the simulation flag unset/false.
2. Confirm chain ID 5042 and sequential simulation with native EOA balance overrides. Read native and USDC ERC-20 balances on that same wallet: native uses 18 decimals, the ERC-20 interface 6. No token/router/pool storage or code overrides are permitted.
3. Select an existing liquid custom-token pool. Verify chain, token and quote contract, router, exact V4 pool-key hash, fee and hook assumptions. Unsupported routes remain withheld.
4. In a read-only validation process using the candidate code, simulate buys and full same-wallet sells at 10, 100 and 500 USDC, pinned to one block. Verify quote debit, acquired tokens, complete sell, remaining token balance zero and returned quote. Confirm loss is no greater than 10% at every size; reported loss excludes gas.
5. Check revert, missing USDC alias, wrong quote decimals, partial sell and excessive-loss rejections. Repeat against the actual production provider, not a documentation demo endpoint.
6. Only after those checks pass: merge the candidate, deploy the exact tested commit and enable the flag. Verify custom alert delivery through its security gate and the existing recipient delays. PONS origin bypass stays intact.

The prototype supports plain verified Uniswap V4 routes only. A provider flags-only response or successful quote is not proof of sellability. Keep unknown/unverified routes withheld.
