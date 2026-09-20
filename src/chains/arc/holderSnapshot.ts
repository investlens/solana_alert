import { decodeEventLog, formatUnits, parseAbiItem } from 'viem';
import { getArcLogs, readArcContract } from './rpc.js';

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ERC20 = [
  { type:'function', name:'totalSupply', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'decimals', stateMutability:'view', inputs:[], outputs:[{type:'uint8'}] },
] as const;

export type ArcHolderSnapshot = {
  balancesPct: Record<string, number>;
  topHolderPct: number | null;
  top5HolderPct: number | null;
  evidence: string[];
};

const norm = (v: unknown) => String(v ?? '').toLowerCase();
const excludedDefault = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
]);

/**
 * Reconstructs balances from bounded Transfer logs. This is intended for
 * shadow/forensic use after a candidate qualifies, never as a chain-wide
 * holder indexer. If the supplied start block does not cover token inception,
 * percentages are not published because the snapshot would be incomplete.
 */
export async function reconstructArcHolderSnapshot(args: {
  token: string;
  fromBlock: bigint;
  toBlock: bigint;
  inceptionCovered: boolean;
  excludedAddresses?: string[];
}): Promise<ArcHolderSnapshot> {
  if (!args.inceptionCovered) {
    return { balancesPct:{}, topHolderPct:null, top5HolderPct:null, evidence:['holder snapshot not confirmed: token inception not covered'] };
  }

  const logs = await getArcLogs({
    address: args.token as `0x${string}`,
    event: TRANSFER,
    fromBlock: args.fromBlock,
    toBlock: args.toBlock,
  });

  const [supplyRaw, decimalsRaw] = await Promise.all([
    readArcContract({ address:args.token, abi:ERC20, functionName:'totalSupply' }),
    readArcContract({ address:args.token, abi:ERC20, functionName:'decimals' }).catch(()=>18),
  ]);
  const supply = BigInt(supplyRaw as any);
  const decimals = Number(decimalsRaw ?? 18);
  if (supply <= 0n) return { balancesPct:{}, topHolderPct:null, top5HolderPct:null, evidence:['holder snapshot not confirmed: invalid total supply'] };

  const balances = new Map<string,bigint>();
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi:[TRANSFER], data:log.data, topics:log.topics });
      const e = decoded.args as { from?:string; to?:string; value?:bigint };
      if (!e.value || e.value <= 0n) continue;
      const from = norm(e.from);
      const to = norm(e.to);
      if (from) balances.set(from, (balances.get(from) ?? 0n) - e.value);
      if (to) balances.set(to, (balances.get(to) ?? 0n) + e.value);
    } catch {}
  }

  const excluded = new Set([...excludedDefault, ...(args.excludedAddresses ?? []).map(norm)]);
  const pctEntries = [...balances.entries()]
    .filter(([wallet,balance]) => !excluded.has(wallet) && balance > 0n)
    .map(([wallet,balance]) => [wallet, Number((balance * 1_000_000n) / supply) / 10_000] as const)
    .sort((a,b)=>b[1]-a[1]);

  return {
    balancesPct:Object.fromEntries(pctEntries),
    topHolderPct:pctEntries[0]?.[1] ?? 0,
    top5HolderPct:pctEntries.slice(0,5).reduce((sum,row)=>sum+row[1],0),
    evidence:[
      `transfer logs=${logs.length}`,
      `holders reconstructed=${pctEntries.length}`,
      `supply=${formatUnits(supply, decimals)}`,
    ],
  };
}
