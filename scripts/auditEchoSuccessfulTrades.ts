/**
 * Read-only Solana caller trade extraction and Echo coverage audit.
 * Usage: ECHO_RPC_URL=<existing RPC URL> node --import tsx scripts/auditEchoSuccessfulTrades.ts output.json
 * No Telegram sends, transactions, orders or configuration changes.
 * Bounded to 4 callers, 40 recent signatures each, sequential calls.
 */
import { writeFile } from 'node:fs/promises';
import { ECHO_WALLETS, SOL_MINT } from '../src/echo/signals.js';
import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';

const url=process.env.ECHO_RPC_URL || process.env.QUICKNODE_RPC_URL;
const output=process.argv[2];
if(!url || !output) throw Error('Set ECHO_RPC_URL or QUICKNODE_RPC_URL; specify output path');
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
let requestCount=0;
async function rpc(method:string,params:unknown[]):Promise<any>{
  if(requestCount++>0) await sleep(250);
  const response=await fetch(url!,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:requestCount,method,params}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('RPC HTTP '+response.status);
  const data=await response.json();
  if(data.error)throw Error('RPC '+String(data.error.code));
  return data.result;
}
type RecordRow={caller:string;wallet:string;signature:string;blockTime:number|null;status:string;
  detectedSide:string|null;mint:string|null;reason:string|null;tokenDeltas:{mint:string;deltaRaw:string;decimals:number}[];
  signer:boolean; swapPrograms:string[]};
const rows:RecordRow[]=[];
const failures:{caller:string;signature?:string;reason:string}[]=[];
for(const [wallet,caller] of Object.entries(ECHO_WALLETS)){
  let signatures:any[];
  try{
    signatures=await rpc('getSignaturesForAddress',[wallet,{limit:40,commitment:'finalized'}]);
    if(!Array.isArray(signatures))throw Error('Invalid signature response');
  }catch(e){failures.push({caller,reason:String(e)});continue;}
  for(const item of signatures){
    if(item.err!=null)continue;
    const signature=String(item.signature??'');
    if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))continue;
    try{
      const tx=await rpc('getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:1}]) as ParsedTransactionWithMeta|null;
      if(!tx?.meta||tx.meta.err!==null)continue;
      const keys=tx.transaction.message.accountKeys;
      const key=(v:any)=>typeof v==='string'?v:v?.toBase58?.()??'';
      const signer=keys.some(k=>k.signer===true&&key(k.pubkey)===wallet);
      const balances=new Map<string,{before:bigint;after:bigint;decimals:number}>();
      for(const side of ['preTokenBalances','postTokenBalances'] as const){
        for(const b of tx.meta[side]??[]){
          if(b.owner!==wallet||!/^[0-9]+$/.test(b.uiTokenAmount.amount))continue;
          const k=b.mint+':'+b.accountIndex;
          const record=balances.get(k)??{before:0n,after:0n,decimals:b.uiTokenAmount.decimals};
          if(side==='preTokenBalances')record.before=BigInt(b.uiTokenAmount.amount);
          else record.after=BigInt(b.uiTokenAmount.amount);
          balances.set(k,record);
        }
      }
      const deltas=new Map<string,{delta:bigint;decimals:number}>();
      for(const [k,b] of balances){const mint=k.split(':')[0];const rec=deltas.get(mint)??{delta:0n,decimals:b.decimals};rec.delta+=b.after-b.before;deltas.set(mint,rec);}
      const tokenDeltas=[...deltas].filter(([,v])=>v.delta!==0n).map(([mint,v])=>({mint,deltaRaw:v.delta.toString(),decimals:v.decimals}));
      const instructions=[...tx.transaction.message.instructions,...(tx.meta.innerInstructions??[]).flatMap(x=>x.instructions)];
      const swapPrograms=[...new Set(instructions.map((i:any)=>key(i.programId)).filter(Boolean))].slice(0,30);
      const found=extractRpcEchoSignals(tx,signature,(tx.blockTime??0)+1).filter(v=>v.wallet===wallet);
      rows.push({caller,wallet,signature,blockTime:tx.blockTime,status:'SUCCESS_ON_CHAIN',
        detectedSide:found[0]?.side??null,mint:found[0]?.mint??null,
        reason:found.length?null:classifyEchoRejection(tx,signature,(tx.blockTime??0)+1),
        tokenDeltas,signer,swapPrograms});
    }catch(e){failures.push({caller,signature,reason:String(e).slice(0,140)})}
  }
}
await writeFile(output,JSON.stringify({schema:'alphaos.echo.trade-audit.v1',readOnly:true,
 note:'On-chain success alone does not establish a swap, profit, or whether a notification was delivered. Token deltas require program-level swap verification.',
  sampleLimitPerCaller:40,requests:requestCount,rows,failures},null,2),{mode:0o600});
console.log(JSON.stringify({transactions:rows.length,recognized:rows.filter(x=>x.detectedSide).length,
  unrecognized:rows.filter(x=>!x.detectedSide).length,failures:failures.length,requests:requestCount}));
