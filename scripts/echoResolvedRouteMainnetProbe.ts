/** One-shot, bounded mainnet ALT + token-destination read-only audit.
 * Third-party local builder is NOT a trusted source of transaction safety.
 * No keys, no quotes accepted as proof, no simulation send, no trading.
 * MAX 1 local-builder + 1 ALT RPC + 1 mint RPC = 3 calls.
 */
import {AddressLookupTableAccount,AddressLookupTableProgram,PublicKey}
 from '@solana/web3.js';
import {auditEchoResolvedUnsignedBuy} from '../src/echo/resolvedUnsignedBuyAudit.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const rpc='https://api.mainnet-beta.solana.com/';
const url='https://pumpportal.fun/api/trade-local';
let builderCalls=0,rpcCalls=0;
async function jsonRpc(method:string,address:string){
 if(rpcCalls>=2)throw Error('RPC_READ_LIMIT');
 rpcCalls++;
 const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(5000),
  body:JSON.stringify({jsonrpc:'2.0',id:rpcCalls,method,
    params:[address,{commitment:'confirmed',encoding:'base64'}]})});
 if(!response.ok)throw Error('PUBLIC_RPC_HTTP_'+response.status);
 const body=await response.json();
 if(body.error)throw Error('PUBLIC_RPC_METHOD_'+String(body.error.code));
 return body.result?.value??null;
}
let result:Awaited<ReturnType<typeof auditEchoResolvedUnsignedBuy>>|null=null;
let reason:string|null=null,builderMs:number|null=null;
try{
 builderCalls++;
 const started=Date.now();
 const response=await fetch(url,{method:'POST',
  headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(5000),
  body:JSON.stringify({
   publicKey:wallet,action:'buy',mint,amount:0.01,
   denominatedInSol:'true',slippage:3,priorityFee:0,pool:'pump'
  })});
 if(!response.ok)throw Error('BUILDER_HTTP_'+response.status);
 const bytes=Buffer.from(await response.arrayBuffer());
 builderMs=Date.now()-started;
 if(bytes.length<100||bytes.length>2250)throw Error('INVALID_UNSIGNED_BUILDER_BYTES');
 const base64=bytes.toString('base64');
 result=await auditEchoResolvedUnsignedBuy({
  base64,wallet,mint,
  lookupProvider:{lookup:async key=>{
   const value=await jsonRpc('getAccountInfo',key.toBase58());
   if(!value||value.owner!==AddressLookupTableProgram.programId.toBase58()||
       !Array.isArray(value.data)||typeof value.data[0]!=='string')return null;
   const data=Buffer.from(value.data[0],'base64');
   return new AddressLookupTableAccount({
     key,state:AddressLookupTableAccount.deserialize(data)
   });
  }},
  accountProvider:{getAccounts:async keys=>{
   if(keys.length!==1||keys[0].toBase58()!==mint)throw Error('ONLY_MINT_STATE_ALLOWED');
   const value=await jsonRpc('getAccountInfo',mint);
   if(!value)return [null];
   if(!Array.isArray(value.data)||typeof value.data[0]!=='string')
     throw Error('INVALID_MINT_DATA');
   return [{owner:new PublicKey(value.owner),
    data:Buffer.from(value.data[0],'base64'),executable:value.executable===true}];
  }}
 });
}catch(err){reason=err instanceof Error?err.message:'UNKNOWN_READ_ONLY_ERROR'}
const report={
 mode:'MAINNET_RESOLVED_ROUTE_AUDIT',builderRequests:builderCalls,
 rpcReads:rpcCalls,totalReadRequests:builderCalls+rpcCalls,
 builderMs,passedStructuralAudit:result?.ok??false,
 auditReason:result&&!result.ok?result.reason:reason,
 lookupTables:result?.ok?result.lookupTables:null,
 accountCount:result?.ok?result.resolvedAccounts:null,
 unknownPrograms:result?.ok?result.unreviewedPrograms:[],
 unsupportedInstructions:result?.ok?result.unsupportedInstructions:[],
 destinationDerived:result?.ok?result.expectedDestinationDerived:false,
 priceAndActualTokenCreditVerified:false,
 signingApproved:false,broadcast:false,privateKeys:false,
 safeReadLimitHonored:builderCalls<=1&&rpcCalls<=2
};
process.stdout.write('ECHO_MAINNET_RESOLVED_ROUTE '+JSON.stringify(report)+'\n');
if(!result?.ok)process.exitCode=1;
