import { decodeEventLog, parseAbiItem } from 'viem';
const SWAP = parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const TRANSFER = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const address = (v: unknown): v is string => typeof v === 'string' && /^0x[a-f0-9]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const hash = (v: unknown): v is string => typeof v === 'string' && /^0x[a-f0-9]{64}$/i.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^0x[a-f0-9]+$/i.test(v);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Read-only, offline V4 receipt inspection. Caller must establish chain,
 * pool-key/token membership and manager provenance separately. Receipt matching
 * does not verify finality, independence, holding retention or current sellability.
 * Raw integer amounts avoid page float precision and gross/net confusion. */
export function inspectDemandReceipt(input: {
  token: string; poolId: string; manager: string; trader: string; txHash: string;
  logIndex: number; tokenIs0: boolean; side: 'buy' | 'sell'; receipt: unknown;
}) {
  const { token, poolId, manager, trader, txHash, receipt } = input;
  const r = receipt as any;
  if (![token, manager, trader].every(address) || !hash(poolId) || !hash(txHash)
    || !Number.isSafeInteger(input.logIndex) || input.logIndex < 0 || typeof input.tokenIs0 !== 'boolean'
    || !['buy', 'sell'].includes(input.side) || r?.status !== '0x1' || !hash(r.transactionHash)
    || !same(r.transactionHash, txHash) || !address(r.from) || !same(r.from, trader)
    || !hash(r.blockHash) || !hex(r.blockNumber) || !Array.isArray(r.logs) || r.logs.length > 256) return null;
  let swap: { tokenRaw: bigint; quoteRaw: bigint } | null = null;
  let net = 0n; const indices = new Set<string>();
  for (const l of r.logs) {
    if (!l || l.removed || !hash(l.transactionHash) || !same(l.transactionHash, txHash)
      || !hash(l.blockHash) || !same(l.blockHash, r.blockHash) || !hex(l.blockNumber)
      || BigInt(l.blockNumber) !== BigInt(r.blockNumber) || !hex(l.logIndex)
      || !address(l.address) || !Array.isArray(l.topics)) return null;
    const index = BigInt(l.logIndex).toString();
    if (indices.has(index)) return null; indices.add(index);
    if (same(l.address, manager) && BigInt(l.logIndex) === BigInt(input.logIndex)) {
      try {
        const { args } = decodeEventLog({ abi: [SWAP], topics: l.topics, data: l.data });
        if (!same(args.id, poolId)) return null;
        const tokenRaw = input.tokenIs0 ? args.amount0 : args.amount1;
        const quoteRaw = input.tokenIs0 ? args.amount1 : args.amount0;
        if (!(input.side === 'buy' ? tokenRaw > 0n && quoteRaw < 0n : tokenRaw < 0n && quoteRaw > 0n)) return null;
        swap = { tokenRaw, quoteRaw };
      } catch { return null; }
    }
    if (same(l.address, token) && typeof l.topics[0] === 'string'
      && l.topics[0].toLowerCase() === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
      try {
        const { args } = decodeEventLog({ abi: [TRANSFER], topics: l.topics, data: l.data });
        if (same(args.to, trader)) net += args.value;
        if (same(args.from, trader)) net -= args.value;
      } catch { return null; }
    }
  }
  if (!swap) return null;
  return { matchedSwap: true as const, swapTokenRaw: swap.tokenRaw.toString(), swapQuoteRaw: swap.quoteRaw.toString(),
    initiatorNetTokenRaw: net.toString(),
    initiatorReceivedNetTokens: net > 0n,
    beneficiaryOwnership: 'UNVERIFIED' as const,
    eligibleForAlert: false as const };
}
