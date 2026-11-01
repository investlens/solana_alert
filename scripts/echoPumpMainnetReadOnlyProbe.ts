/**
 * One-shot mainnet Pump.fun unsigned preview. DO NOT sign or send.
 * Read-only local builder (third party PumpPortal), then at most one Solana
 * simulateTransaction. No retries, no secret key, no Telegram events.
 *
 * A builder HTTP POST is not a Solana transaction broadcast.
 * Third-party builder charges can apply on executed trades; no execution here.
 */
import {readOnlyPumpLocalPreview} from '../src/echo/readOnlyPumpLocalPreview.js';
import {PublicKey} from '@solana/web3.js';
const e=process.env;
const wallet=e.ECHO_PREVIEW_WALLET?.trim()??'';
const mint=e.ECHO_PREVIEW_MINT?.trim()??'';
const rpcUrl=e.ECHO_PREVIEW_RPC_URL?.trim()??'';
const pool=e.ECHO_PREVIEW_POOL??'pump';
const amount=Number(e.ECHO_PREVIEW_AMOUNT_SOL??'0.01');
const normalizedRpc=(()=>{try{return new URL(rpcUrl).toString()}catch{return ''}})();
if(!wallet||!mint||!rpcUrl||!['pump','pump-amm','raydium','auto'].includes(pool)||
 !Number.isFinite(amount)||amount<=0||amount>0.1)throw Error('INVALID_READ_ONLY_INPUT');
const valid=(v:string)=>{try{return new PublicKey(v).toBase58()===v}catch{return false}};
if(!valid(wallet)||!valid(mint)||!rpcUrl.startsWith('https://'))
 throw Error('INVALID_READ_ONLY_ACCOUNT_OR_RPC');
let requests=0,builderRequests=0,simRequests=0;
const allowed:typeof fetch=(async(url:any,options?:any)=>{
 requests++;
 const address=String(url);
 if(address==='https://pumpportal.fun/api/trade-local'&&options?.method==='POST'){
   builderRequests++;
   if(builderRequests!==1||requests>2)throw Error('PREVIEW_BUDGET_EXCEEDED');
   const request=JSON.parse(String(options.body));
   if(request.action!=='buy'||request.priorityFee!==0||request.publicKey!==wallet||
       request.amount!==amount||request.slippage!==3||request.mint!==mint)
     throw Error('UNAUTHORIZED_BUILDER_PARAMETERS');
 }else if(address===normalizedRpc&&options?.method==='POST'){
   simRequests++;
   if(simRequests!==1||requests>2)throw Error('PREVIEW_BUDGET_EXCEEDED');
   const request=JSON.parse(String(options.body));
   if(request.method!=='simulateTransaction'||request.params?.[1]?.sigVerify!==false)
     throw Error('BROADCAST_OR_SIGNATURE_VERIFY_FORBIDDEN');
 }else throw Error('UNEXPECTED_NETWORK_CALL');
 return fetch(url,options);
}) as typeof fetch;
const started=Date.now();
const result=await readOnlyPumpLocalPreview({
 side:'BUY',wallet,mint,amount,slippagePercent:3,rpcUrl,
 pool:pool as 'pump'|'pump-amm'|'raydium'|'auto'
},allowed);
const report={
 mode:'MAINNET_UNSIGNED_READ_ONLY',executionEnabled:false,signed:false,broadcast:false,
 provider:'THIRD_PARTY_PUMPPORTAL_LOCAL_BUILDER',
 localBuilderFeeOnExecutedTradeBps:50,
 pool,amountSol:amount,
 result:result.ok?'SIMULATED_UNAUTHORIZED':'NOT_VERIFIED',
 reason:result.reason,
 failureClass:result.failureClass??null,
 failingInstructionIndex:result.failingInstructionIndex??null,
 customErrorCode:result.customErrorCode??null,
 unsignedHash:result.transactionHash??null,
 programCount:result.programs?.length??null,
 unresolvedLookupTables:result.unresolvedLookupTables??null,
 signingApproved:result.signingApproved??false,
 unitsConsumed:result.unitsConsumed??null,
 worstCasePriorityLamports:result.worstCasePriorityLamports??null,
 builderMs:result.builderMs??null,simulationMs:result.simulationMs??null,
 endToEndMs:Date.now()-started,
 builderRequests,simulationRequests:simRequests,
 nonExecutionProof:requests<=2&&builderRequests<=1&&simRequests<=1
};
process.stdout.write('ECHO_PUMP_MAINNET_READ_ONLY '+JSON.stringify(report)+'\n');
// An unavailable public builder/RPC or unfunded wallet is evidence of an
// unverified path, never a success claim. Failure is deliberately visible.
if(!result.ok)process.exitCode=1;
