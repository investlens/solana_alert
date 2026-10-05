/** Read-only smoke check. No database/cache writes or Telegram delivery. */
import { parseAbiItem, toEventSelector, decodeEventLog } from 'viem';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import { analyzeSupplyJourney } from '../src/services/supplyJourney.js';

const endpoint = process.env.SUPPLY_VALIDATION_RPC_URL;
if (!endpoint) throw Error('Set SUPPLY_VALIDATION_RPC_URL to an approved Robinchain RPC endpoint');
const deadline = Date.now() + 25000;
let calls = 0;
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  if (++calls > 40 || Date.now() >= deadline) throw Error('Validation budget exhausted');
  const response = await fetch(endpoint!, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: calls, method, params }),
    signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
  });
  if (!response.ok) throw Error(`RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: T; error?: unknown };
  if (body.error || body.result === undefined) throw Error('RPC returned no usable result');
  return body.result;
}
try {
  if (BigInt(await rpc<string>('eth_chainId', [])) !== 4663n) throw Error('Wrong chain');
  const head = BigInt(await rpc<string>('eth_blockNumber', []));
  if (head < 40n) throw Error('Insufficient block history');
  const end = head - 40n;
  const start = end > 9999n ? end - 9999n : 0n;
  const factory = getPonsFactoryDeployments().find(f => f.id === 'v2-current' && f.enabled)!;
  const abi = parseAbiItem(factory.tokenLaunchedEvent);
  const logs = await rpc<any[]>('eth_getLogs', [{ address: factory.address,
    fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16), topics: [toEventSelector(abi)] }]);
  if (!Array.isArray(logs) || logs.length > 200) throw Error('Launch response exceeds validation cap');
  const samples = logs.filter(l => !l.removed && l.address?.toLowerCase() === factory.address.toLowerCase()).slice(-2);
  if (!samples.length) throw Error('No recent launches available; live coverage remains unvalidated');
  let complete = 0;
  for (const log of samples) {
    const decoded = decodeEventLog({ abi: [abi], data: log.data, topics: log.topics, strict: true });
    const args = decoded.args as { token: string; deployer: string; curve: string };
    const began = Date.now();
    const result = await analyzeSupplyJourney(args.token, { rpc, now: Date.now,
      marker: async () => ({ token: args.token, creator: args.deployer, curveAddress: args.curve, factory: factory.address }) });
    console.log(JSON.stringify({ token: args.token, launchTx: log.transactionHash,
      status: result.status, reason: result.reason, durationMs: Date.now() - began,
      checkedBlock: result.block, creator: result.creator, holding: result.holding, supply: result.total,
      transfers: result.transfers, recipients: result.recipients }));
    if (result.status === 'WINDOW_COMPLETE') complete++;
  }
  console.log(JSON.stringify({ samples: samples.length, complete, logicalRpcCalls: calls,
    independentExplorerComparison: 'REQUIRED', productionRouteLatency: 'REQUIRED' }));
  if (complete !== samples.length) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ status: 'LIVE_VALIDATION_BLOCKED', logicalRpcCalls: calls,
    note: 'RPC inaccessible, invalid response or budget exceeded. No release approval.' }));
  process.exitCode = 1;
}
