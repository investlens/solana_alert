/** BUY-FIRST preview for pilot rollout: no Telegram SELL preflight dependency.
 * Does NOT approve signer, authorize spending, prove wallet-app exits, reserve
 * slots, or broadcast. Live signer must independently enforce hard safety gates.
 */
import {screenEchoPilotTotalBudget,type EchoPilotBudgetInput} from './pilotTotalBudgetGuard.js';
import {screenEchoTenDollarPilot,type PilotOrder} from './tenDollarPilot.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';
import {previewEchoOwnerPositionSize,type EchoSizingPolicy} from './ownerPositionSizePolicy.js';
import {readOnlyEchoJupiterV2Swap,type EchoJupiterV2PreviewRequest,
 type EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';

export const ECHO_BUY_FIRST_LIVE_ENABLED=false as const;
export type EchoBuyFirstInput={
 order:PilotOrder;budget:EchoPilotBudgetInput;executionWallet:string;
 /** Optional trusted owner-tier specification; 0.025 SOL for first funded pilot. */
 positionSizing?:EchoSizingPolicy;
 rpcUrl:string;jupiterApiKey:string;
 /** Verified privileged chain-wallet check, NOT a Telegram/client flag. */
 sameWalletManualExitAccessVerified:boolean;
 /** Whether operator explicitly accepts manual-app-only SELL. */
 manualExitRiskAcknowledged:boolean;
 /** Privileged, fresh USD market capitalization (no FDV substitution). */
 marketCapUsd:number;marketCapObservedAtMs:number;
 /** Price from verified caller receipt, not social post or transfer. */
 callerEntryPriceSolPerToken:number;tokenDecimals:number;
};
export type EchoBuyFirstPreview={
 eligible:boolean;executable:false;reason:string;mode:'READ_ONLY_BUY_FIRST';
 buyQuoteHash:string|null;
};
type Preview=(req:EchoJupiterV2PreviewRequest)=>Promise<EchoJupiterV2PreviewResult>;
export async function previewEchoBuyFirst(
 input:EchoBuyFirstInput,preview:Preview=readOnlyEchoJupiterV2Swap
):Promise<EchoBuyFirstPreview>{
 const stop=(reason:string):EchoBuyFirstPreview=>({
  eligible:false,executable:false,reason,mode:'READ_ONLY_BUY_FIRST',buyQuoteHash:null});
 if(!verifyEchoExecutionWallet(input.executionWallet))return stop('WRONG_EXECUTION_WALLET');
 // These preflight flags are not trusted live authorization. An isolated
 // signer MUST verify cryptographic wallet ownership and server-side policy.
 if(!input.sameWalletManualExitAccessVerified||!input.manualExitRiskAcknowledged)
  return stop('SAME_WALLET_MANUAL_EXIT_UNVERIFIED');
 if(!Number.isFinite(input.marketCapUsd)||input.marketCapUsd<=0||
    input.marketCapUsd>=100_000||
    !Number.isSafeInteger(input.marketCapObservedAtMs)||
    input.marketCapObservedAtMs>input.order.nowMs||
    input.order.nowMs-input.marketCapObservedAtMs>2000)
  return stop('MARKET_CAP_UNVERIFIED_OR_ABOVE_100K');
 if(!Number.isFinite(input.callerEntryPriceSolPerToken)||
    input.callerEntryPriceSolPerToken<=0||
    !Number.isSafeInteger(input.tokenDecimals)||input.tokenDecimals<0||
    input.tokenDecimals>12)return stop('CALLER_ENTRY_OR_DECIMALS_UNVERIFIED');
 if(!input.rpcUrl||!input.jupiterApiKey?.trim())return stop('MISSING_PROVIDER');
 const principal=Number(input.budget.newPrincipalCents);
 if(!Number.isSafeInteger(principal)||principal<1||principal>1000)
  return stop('INVALID_PRINCIPAL');
 const size=screenEchoTenDollarPilot(input.order,principal);
 if('reason' in size)return stop('PILOT_'+size.reason);
 let buyAmountLamports=size.amountLamports;
 if(input.positionSizing){
  const fixed=previewEchoOwnerPositionSize(input.positionSizing);
  if(!fixed.eligible)return stop('POSITION_SIZE_'+fixed.reason);
  if(input.positionSizing.requestedSol!=='0.025'&&
     !input.positionSizing.firstTradeAndManualExitVerified)
    return stop('POSITION_SIZE_FIRST_ROUND_TRIP_UNVERIFIED');
  if(fixed.principalCents!==input.budget.newPrincipalCents||
     input.positionSizing.estimatedFeeAndOtherCostsCents!==input.budget.allInBuyCostsCents||
     input.positionSizing.cumulativeCommittedCents!==input.budget.cumulativeCommittedCents)
    return stop('POSITION_SIZE_BUDGET_MISMATCH');
  if(fixed.lamports!=='25000000'&&input.positionSizing.requestedSol==='0.025')
    return stop('POSITION_SIZE_WRONG_INITIAL_LAMPORTS');
  buyAmountLamports=Number(fixed.lamports);
 }
 const budget=screenEchoPilotTotalBudget(input.budget);
 if(!budget.eligible)return stop('BUDGET_'+budget.reason);
 try{
  const quote=await preview({
   side:'BUY',rpcUrl:input.rpcUrl,publicWallet:input.executionWallet,
   mint:input.order.mint,amountRaw:String(buyAmountLamports),
   maxSlippageBps:1000,jupiterApiKey:input.jupiterApiKey
  });
  if(!quote.ok)return stop('BUY_'+quote.reason);
  if(quote.side!=='BUY'||quote.inputMint!=='So11111111111111111111111111111111111111112'||
     quote.outputMint!==input.order.mint||
     quote.inputRaw!==String(size.amountLamports)||
     !/^[1-9][0-9]*$/.test(quote.quotedOutputRaw)||
     !quote.unsignedAudit?.feeEstimateComplete||
     quote.unsignedAudit.feePayer!==input.executionWallet||
     !Number.isSafeInteger(quote.unitsConsumed)||(quote.unitsConsumed??0)<=0)
   return stop('BUY_QUOTE_OR_SIMULATION_UNVERIFIED');
  const tokensReceived=Number(quote.quotedOutputRaw)/10**input.tokenDecimals;
  const observedPriceSolPerToken=(buyAmountLamports/1e9)/tokensReceived;
  if(!Number.isFinite(observedPriceSolPerToken)||observedPriceSolPerToken<=0)
   return stop('QUOTE_PRICE_UNVERIFIED');
  const premiumBps=(observedPriceSolPerToken/input.callerEntryPriceSolPerToken-1)*10_000;
  if(!Number.isFinite(premiumBps)||premiumBps>5000)
   return stop('CALLER_PRICE_PREMIUM_EXCEEDS_50_PERCENT');
  return {eligible:true,executable:false,reason:'BUY_PREVIEW_ONLY_NO_SIGNING',
   mode:'READ_ONLY_BUY_FIRST',buyQuoteHash:quote.unsignedTransactionSha256};
 }catch{return stop('BUY_PROVIDER_UNAVAILABLE');}
}
