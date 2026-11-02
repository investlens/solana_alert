/** Real read-only auto-BUY research trial; no wallet keys, send, signing, or trade.
 *
 * Unlike synthetic timing tests this records request duration for a real
 * Jupiter /order + on-chain simulateTransaction preview, followed by ONE
 * scoped recent-prioritization-fee read. No retries / provider fan-out.
 * The trial is deliberately fail-closed and cannot reserve or execute.
 */
import {validateBuyAdmission,type BuyAdmission} from './liveBuyPolicy.js';
import {readOnlyEchoJupiterV2Swap,type EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';
import {readEchoRecentPrioritizationFees,type EchoRpcFeeSnapshot} from './recentPriorityFeeReadOnly.js';
import {screenEchoAutoBuyShadow} from './autoBuyShadowGate.js';
import {planEchoLandingFee} from './landingFeeShadow.js';

export const ECHO_AUTO_BUY_READ_ONLY_TRIAL=true as const;
export const ECHO_AUTO_BUY_REAL_EXECUTION_ENABLED=false as const;
const MAX_INPUT_LAMPORTS=100_000_000; // 0.1 SOL
const MAX_SIGNAL_AGE_MS=3_000;
type TrialInput={
 signal:BuyAdmission;executionWallet:string;rpcUrl:string;jupiterApiKey:string;
 callerTradeAtMs:number;verifiedAtMs:number;
 /** Proven by on-chain token-mint metadata before calling the preview. */
 tokenDecimals:number;tokenDecimalsVerified:boolean;
 /** Independent verified caller execution price, SOL/token. */
 callerEntryPriceSolPerToken:number;callerEntryPriceVerified:boolean;
 purchasedOrReservedMint:boolean;openOrPendingPositions:number;
 realizedLossSolToday:number;killSwitch:boolean;
 sellRouteVerified:boolean;
};
type TrialDeps={
 fetcher?:typeof fetch;clock?:()=>number;
 preview?:typeof readOnlyEchoJupiterV2Swap;
 readFees?:typeof readEchoRecentPrioritizationFees;
};
type TrialResult={
 candidate:boolean;reason:string;mode:'READ_ONLY_SHADOW';broadcast:false;
 signed:false;callsExpectedAtMost:3;
 timings:{quoteAndSimulationMs:number;feeSamplingMs:number;totalMs:number};
 verifiedQuotePriceSolPerToken:number|null;
 measuredComputeUnits:number|null;estimatedPriorityLamports:string|null;
 transactionSha256:string|null;
};
const deny=(reason:string,timings:TrialResult['timings']={
 quoteAndSimulationMs:0,feeSamplingMs:0,totalMs:0}):TrialResult=>({
 candidate:false,reason,mode:'READ_ONLY_SHADOW',broadcast:false,signed:false,
 callsExpectedAtMost:3,timings,verifiedQuotePriceSolPerToken:null,
 measuredComputeUnits:null,estimatedPriorityLamports:null,transactionSha256:null});
export async function runEchoAutoBuyReadOnlyTrial(
 input:TrialInput,deps:TrialDeps={}
):Promise<TrialResult>{
 const clock=deps.clock??Date.now;const initial=clock();
 if(!Number.isSafeInteger(initial)||!Number.isSafeInteger(input.verifiedAtMs)||
    !Number.isSafeInteger(input.callerTradeAtMs)||input.verifiedAtMs>initial||
    initial<input.callerTradeAtMs||initial-input.callerTradeAtMs>MAX_SIGNAL_AGE_MS||
    input.verifiedAtMs<input.callerTradeAtMs)
  return deny('STALE_OR_UNVERIFIED_SIGNAL');
 if(input.killSwitch)return deny('KILL_SWITCH');
 const admission=validateBuyAdmission(input.signal,input.executionWallet);
 if('reason' in admission)return deny(admission.reason);
 if(input.purchasedOrReservedMint)return deny('DUPLICATE_MINT');
 if(!Number.isSafeInteger(input.openOrPendingPositions)||input.openOrPendingPositions>=2||
    input.openOrPendingPositions<0)return deny('POSITION_LIMIT');
 if(!Number.isFinite(input.realizedLossSolToday)||input.realizedLossSolToday<0||
    input.realizedLossSolToday>=0.15)return deny('DAILY_LOSS_BREAKER');
 if(!input.sellRouteVerified)return deny('SELL_ROUTE_NOT_VERIFIED');
 if(!input.callerEntryPriceVerified||!Number.isFinite(input.callerEntryPriceSolPerToken)||
    input.callerEntryPriceSolPerToken<=0)return deny('CALLER_ENTRY_PRICE_UNVERIFIED');
 if(!input.tokenDecimalsVerified||!Number.isSafeInteger(input.tokenDecimals)||
    input.tokenDecimals<0||input.tokenDecimals>12)
  return deny('MINT_DECIMALS_UNVERIFIED');
 if(!input.rpcUrl||!input.executionWallet||!input.jupiterApiKey?.trim())
  return deny('REAL_READ_ONLY_PROVIDER_ACCESS_REQUIRED');
 // Tag when the exact /order response finished. No synthetic quote duration.
 let orderResponseAtMs:number|null=null;
 const realFetch=deps.fetcher??fetch;
 const instrumented:typeof fetch=(async(url:any,options?:any)=>{
   const isOrder=String(url).startsWith('https://api.jup.ag/swap/v2/order?');
   const response=await realFetch(url,options);
   if(isOrder)orderResponseAtMs=clock();
   return response;
 }) as typeof fetch;
 const previewFn=deps.preview??readOnlyEchoJupiterV2Swap;
 const begin=clock();
 let preview:EchoJupiterV2PreviewResult;
 try{preview=await previewFn({
   side:'BUY',rpcUrl:input.rpcUrl,publicWallet:input.executionWallet,
   mint:input.signal.mint,amountRaw:String(MAX_INPUT_LAMPORTS),
   maxSlippageBps:1000,jupiterApiKey:input.jupiterApiKey
 },instrumented);}catch{return deny('REAL_READ_ONLY_PREVIEW_FAILED');}
 const previewFinished=clock();
 const timings={quoteAndSimulationMs:previewFinished-begin,feeSamplingMs:0,
   totalMs:previewFinished-initial};
 if(!preview.ok)return deny(preview.reason,timings);
 if(!preview.unsignedAudit||!preview.unsignedAudit.feeEstimateComplete||
    preview.unsignedAudit.signingApproved!==false||
    preview.unsignedAudit.lookupTables!==0||
    preview.unsignedAudit.feePayer!==input.executionWallet)
  return deny('UNSIGNED_ROUTE_AUDIT_INCOMPLETE',timings);
 const feeInOrder=preview.unsignedAudit.worstCasePriorityFeeLamports;
 if(feeInOrder===null||!/^[0-9]+$/.test(feeInOrder)||
    BigInt(feeInOrder)>500_000n)return deny('ORDER_PRIORITY_FEE_CAP_EXCEEDED',timings);
 if(!Number.isSafeInteger(preview.unitsConsumed)||preview.unitsConsumed<10_000||
    preview.unitsConsumed>1_400_000)
  return deny('SIMULATION_CU_UNVERIFIED',timings);
 if(preview.inputRaw!==String(MAX_INPUT_LAMPORTS)||
    preview.outputMint!==input.signal.mint||
    preview.side!=='BUY'||!/^[1-9][0-9]*$/.test(preview.quotedOutputRaw))
  return deny('QUOTE_AMOUNTS_UNVERIFIED',timings);
 const tokens=Number(preview.quotedOutputRaw)/10**input.tokenDecimals;
 const currentPrice=0.1/tokens;
 if(!Number.isFinite(currentPrice)||currentPrice<=0)
  return deny('PRICE_UNVERIFIED',timings);
 // Mocked preview providers do not supply a real GET completion stamp. Mark
 // them unavailable rather than claiming realistic quote freshness.
 const quoteAtMs=orderResponseAtMs;
 if(quoteAtMs===null)return deny('REAL_QUOTE_CLOCK_EVIDENCE_MISSING',timings);
 if(previewFinished-input.callerTradeAtMs>MAX_SIGNAL_AGE_MS||
    previewFinished-quoteAtMs>2_000)
  return deny('STALE_AFTER_REAL_SIMULATION',timings);
 const feeStarted=clock();
 let feeSnapshot:EchoRpcFeeSnapshot;
 try{
  feeSnapshot=await (deps.readFees??readEchoRecentPrioritizationFees)({
    rpcUrl:input.rpcUrl,
    writableAccounts:preview.unsignedAudit.writableAccounts,
    fetcher:instrumented,nowMs:feeStarted
  });
 }catch{return deny('SCOPED_PRIORITY_FEE_READ_FAILED',{
  ...timings,totalMs:clock()-initial,feeSamplingMs:clock()-feeStarted});}
 const finish=clock();
 const actual={quoteAndSimulationMs:previewFinished-begin,
   feeSamplingMs:finish-feeStarted,totalMs:finish-initial};
 if(finish-input.callerTradeAtMs>MAX_SIGNAL_AGE_MS)
  return deny('STALE_AFTER_PRIORITY_FEE_READ',actual);
 const landing=planEchoLandingFee({
  writableAccounts:preview.unsignedAudit.writableAccounts,
  simulationUnitsConsumed:preview.unitsConsumed,samples:feeSnapshot.samples
 });
 if('reason' in landing)return deny(landing.reason,actual);
 const screened=screenEchoAutoBuyShadow({
  signal:input.signal,executionWallet:input.executionWallet,nowMs:finish,
  callerTradeAtMs:input.callerTradeAtMs,verifiedAtMs:input.verifiedAtMs,
  quoteAtMs,callerEntryPriceSolPerToken:input.callerEntryPriceSolPerToken,
  currentQuotePriceSolPerToken:currentPrice,quoteValid:true,
  unsignedSimulationPassed:true,accountsFullyResolved:true,
  sellRouteVerified:input.sellRouteVerified,slippageBps:1000,
  purchasedOrReservedMint:input.purchasedOrReservedMint,
  openOrPendingPositions:input.openOrPendingPositions,
  realizedLossSolToday:input.realizedLossSolToday,killSwitch:input.killSwitch
 });
 return {candidate:screened.candidate,reason:screened.reason,
  mode:'READ_ONLY_SHADOW',signed:false,broadcast:false,
  callsExpectedAtMost:3,timings:actual,verifiedQuotePriceSolPerToken:currentPrice,
  measuredComputeUnits:preview.unitsConsumed,
  estimatedPriorityLamports:landing.plan.estimatedPriorityLamports,
  transactionSha256:preview.unsignedTransactionSha256};
}
