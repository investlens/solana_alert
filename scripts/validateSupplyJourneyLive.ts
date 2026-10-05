/** Read-only smoke check. No database/cache writes or Telegram delivery. */
import { parseAbiItem, toEventSelector, decodeEventLog } from 'viem';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import { analyzeSupplyJourney, decodeJourneyTransfers } from '../src/services/supplyJourney.js';
import {createSupplyJourneyRpc} from '../src/services/supplyJourneyRpc.js';

const endpoint = process.env.SUPPLY_VALIDATION_RPC_URL;
if (!endpoint) throw Error('Set SUPPLY_VALIDATION_RPC_URL to an approved Robinchain RPC endpoint');
const secondary=process.env.SUPPLY_VALIDATION_SECONDARY_RPC_URL;
if(!secondary||secondary===endpoint)throw Error('Set a distinct secondary RPC for independent comparison');
const deadline = Date.now() + 40000;
let calls = 0;
let lastMethod='initialization';
async function request<T>(url:string,method:string,params:unknown[],signal?:AbortSignal):Promise<T>{
  lastMethod=method;
  if(++calls>60||Date.now()>=deadline)throw Error('Validation budget exhausted');
  const timeout=AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())));
  return createSupplyJourneyRpc(url)<T>(method,params,signal?AbortSignal.any([timeout,signal]):timeout);
}
const rpc=<T>(method:string,params:unknown[],signal?:AbortSignal)=>request<T>(endpoint!,method,params,signal);
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
  if(BigInt(await request<string>(secondary,'eth_chainId',[]))!==4663n)throw Error('Secondary wrong chain');
  const samples = logs.filter(l => !l.removed && l.address?.toLowerCase() === factory.address.toLowerCase()).slice(0,2);
  if (!samples.length) throw Error('No recent launches available; live coverage remains unvalidated');
  let complete = 0;
  for (const log of samples) {
    const decoded = decodeEventLog({ abi: [abi], data: log.data, topics: log.topics, strict: true });
    const args = decoded.args as { token: string; deployer: string; curve: string };
    const began = Date.now();
    const reads:{method:string;params:unknown[];result:unknown}[]=[];
    const result = await analyzeSupplyJourney(args.token, { rpc:async<T>(method,params,signal)=>{
      const value=await rpc<T>(method,params,signal);if(['eth_getLogs','eth_call','eth_getBlockByNumber'].includes(method))reads.push({method,params,result:value});return value;
    }, now: Date.now,
      marker: async () => ({ token: args.token, creator: args.deployer, curveAddress: args.curve, factory: factory.address }) });
    console.log(JSON.stringify({ token: args.token, launchTx: log.transactionHash,
      status: result.status, reason: result.reason, durationMs: Date.now() - began,
      checkedBlock: result.block, creator: result.creator, holding: result.holding, supply: result.total,
      transfers: result.transfers, recipients: result.recipients }));
    if(result.status!=='WINDOW_COMPLETE')throw Error('Incomplete primary research');
    for(const read of reads){
      const value=await request<any>(secondary,read.method,read.params);
      if(read.method==='eth_call') {if(BigInt(value)!==BigInt(String(read.result)))throw Error('Balance or supply mismatch');}
      else if(read.method==='eth_getBlockByNumber'){if(value?.hash!==(read.result as any)?.hash)throw Error('Block hash mismatch');}
      else {const query=read.params[0] as any;
        const canonical=(logs:unknown)=>JSON.stringify(decodeJourneyTransfers(logs,args.token.toLowerCase(),BigInt(query.fromBlock),BigInt(query.toBlock)));
        if(canonical(value)!==canonical(read.result))throw Error('Transfer evidence mismatch');
      }
    }
    complete++;
  }
  console.log(JSON.stringify({ samples: samples.length, complete, logicalRpcCalls: calls,
    independentRpcComparison: 'PASSED', launchIdentitySource:'OFFICIAL_FACTORY_EVENT',productionRouteLatency: 'REQUIRED' }));
  if (complete !== samples.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'LIVE_VALIDATION_BLOCKED', logicalRpcCalls: calls,
    stage:lastMethod,reason:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,220):'Unknown failure',
    note: 'RPC inaccessible, invalid response or budget exceeded. No release approval.' }));
  process.exitCode = 1;
}
