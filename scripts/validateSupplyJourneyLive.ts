/** Read-only smoke check. No database/cache writes or Telegram delivery. */
import { parseAbiItem, toEventSelector, decodeEventLog } from 'viem';
import { getPonsFactoryDeployments, PONS_CONTRACTS } from '../src/chains/robinhood/ponsContracts.js';
import { analyzeSupplyJourney, decodeJourneyTransfers, JOURNEY_WINDOW_BLOCKS } from '../src/services/supplyJourney.js';
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
  if(++calls>80||Date.now()>=deadline)throw Error('Validation budget exhausted');
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
  const candidates=logs.filter(l=>!l.removed&&l.address?.toLowerCase()===factory.address.toLowerCase()).slice(-12).reverse();
  if(!candidates.length)throw Error('No recent launches available; live coverage remains unvalidated');
  let positive:any=null;
  // A matching empty window does not validate the recipient-balance path.
  for(const log of candidates){
    const args=decodeEventLog({abi:[abi],data:log.data,topics:log.topics,strict:true}).args as {token:string;deployer:string;curve:string};
    const from=end>=JOURNEY_WINDOW_BLOCKS?end-JOURNEY_WINDOW_BLOCKS+1n:0n;
    const transferLogs=await rpc('eth_getLogs',[{address:args.token,fromBlock:'0x'+from.toString(16),toBlock:'0x'+end.toString(16),topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+args.deployer.slice(2).padStart(64,'0')]}]);
    const excluded=new Set([args.curve,factory.address,args.deployer,PONS_CONTRACTS.swapRouter,PONS_CONTRACTS.positionManager,'0x'+'0'.repeat(40),'0x'+'0'.repeat(36)+'dead'].map(a=>a.toLowerCase()));
    if(decodeJourneyTransfers(transferLogs,args.token.toLowerCase(),from,end).some(row=>BigInt(row.amount)>0n&&!excluded.has(row.to))){positive=log;break;}
  }
  if(!positive)throw Error('No live direct-recipient transfer found in bounded sample; positive coverage remains unvalidated');
  const samples=[positive,...candidates.filter(log=>log.transactionHash!==positive.transactionHash)].slice(0,2);
  let complete = 0;
  let positiveCoverage=false;
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
    let receipts=0;
    if(result.transfers.length>10)throw Error('Positive receipt evidence exceeds validation cap');
    for(const row of result.transfers){
      const receipt=await rpc<any>('eth_getTransactionReceipt',[row.tx]);
      if(receipt?.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==row.tx||BigInt(receipt.blockNumber)!==BigInt(row.block))throw Error('Transfer receipt unavailable or mismatched');
      const matched=decodeJourneyTransfers(receipt.logs.filter((l:any)=>l.address?.toLowerCase()===args.token.toLowerCase()&&l.topics?.[0]?.toLowerCase()==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'),args.token.toLowerCase(),BigInt(row.block),BigInt(row.block)).some(l=>JSON.stringify(l)===JSON.stringify(row));
      if(!matched)throw Error('Transfer does not match receipt evidence');receipts++;
    }
    for(const read of reads){
      // Secondary public access covers only 1024 recent blocks. Never request
      // older logs from it; compare its supported sub-window explicitly.
      const params=read.method==='eth_getLogs'?[{...(read.params[0] as any),fromBlock:'0x'+(BigInt(result.block!)>511n?BigInt(result.block!)-511n:0n).toString(16)}]:read.params;
      const value=await request<any>(secondary,read.method,params);
      if(read.method==='eth_call') {if(BigInt(value)!==BigInt(String(read.result)))throw Error('Balance or supply mismatch');}
      else if(read.method==='eth_getBlockByNumber'){if(value?.hash!==(read.result as any)?.hash)throw Error('Block hash mismatch');}
      else {const query=params[0] as any;
        const canonical=(logs:unknown)=>JSON.stringify(decodeJourneyTransfers(logs,args.token.toLowerCase(),BigInt(query.fromBlock),BigInt(query.toBlock)));
        const primary=(read.result as any[]).filter(row=>BigInt(row.blockNumber)>=BigInt(query.fromBlock));
        if(canonical(value)!==canonical(primary))throw Error('Transfer evidence mismatch');
      }
    }
    complete++;
    console.log(JSON.stringify({token:args.token,receiptEvidenceChecked:receipts,independentBalances:'MATCHED',independentLogWindowBlocks:512}));
    positiveCoverage ||= result.recipients.length>0 && result.recipients.every(row=>row.balance!==null);
  }
  console.log(JSON.stringify({ samples: samples.length, complete, logicalRpcCalls: calls,
    independentRpcComparison: 'BALANCES_AND_RECENT_512_BLOCK_LOGS_PASSED',positiveRecipientCoverage:positiveCoverage,olderTransferEvidence:'OFFICIAL_RPC_TRANSACTION_RECEIPTS', launchIdentitySource:'OFFICIAL_FACTORY_EVENT',productionRouteLatency: 'REQUIRED' }));
  if (complete !== samples.length || !positiveCoverage) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ status: 'LIVE_VALIDATION_BLOCKED', logicalRpcCalls: calls,
    stage:lastMethod,reason:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,220):'Unknown failure',
    note: 'RPC inaccessible, invalid response or budget exceeded. No release approval.' }));
  process.exitCode = 1;
}
