/** One-shot public chain state audit for the candidate Echo execution address.
 * Public address only. NOT proof of wallet custody, ownership or trading safety.
 * At most two read-only public Solana JSON-RPC calls; no retries.
 */
import {PublicKey} from '@solana/web3.js';
const e=process.env,wallet=e.ECHO_PREVIEW_WALLET?.trim()??'',
 mint=e.ECHO_PREVIEW_MINT?.trim()??'';
const valid=(v:string)=>{try{return new PublicKey(v).toBase58()===v}catch{return false}};
if(!valid(wallet)||!valid(mint))throw Error('INVALID_PUBLIC_WALLET_OR_MINT');
const endpoint='https://api.mainnet-beta.solana.com/';
let calls=0;
async function rpc(method:'getBalance'|'getTokenSupply',address:string){
 calls++;
 if(calls>2)throw Error('READ_ONLY_RPC_CAP');
 const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:calls,method,
    params:[address,{commitment:'confirmed'}]}),signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw Error('PUBLIC_RPC_HTTP_'+r.status);
 const j=await r.json();
 if(j.error)throw Error('PUBLIC_RPC_'+String(j.error.code));
 return j.result;
}
let balanceLamports:number|null=null,decimals:number|null=null,reason='COMPLETE';
try{
 const b=await rpc('getBalance',wallet);
 if(!Number.isSafeInteger(b?.value)||b.value<0)throw Error('INVALID_BALANCE_RESPONSE');
 balanceLamports=b.value;
 const t=await rpc('getTokenSupply',mint);
 if(!Number.isSafeInteger(t?.value?.decimals)||t.value.decimals<0||
    t.value.decimals>18)throw Error('INVALID_TOKEN_DECIMALS');
 decimals=t.value.decimals;
}catch(err){reason=err instanceof Error?err.message:'UNKNOWN_READ_ONLY_FAILURE'}
const report={mode:'MAINNET_PUBLIC_STATE_ONLY',walletOwnershipVerified:false,
 candidatePublicAddressOnly:true,tokenMintVerified:decimals!==null,
 balanceLamports,tokenDecimals:decimals,
 theoretical0p1SolBuyHasSufficientBalance:balanceLamports===null?null:
   balanceLamports>=110_000_000,
 rpcReads:calls,reason,privateKeys:false,signing:false,broadcast:false};
process.stdout.write('ECHO_CHAIN_STATE '+JSON.stringify(report)+'\n');
if(reason!=='COMPLETE')process.exitCode=1;
