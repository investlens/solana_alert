/** BUY-FIRST preview for pilot rollout: no Telegram SELL preflight dependency.
 * Does NOT approve signer, authorize spending, prove wallet-app exits, reserve
 * slots, or broadcast. Live signer must independently enforce hard safety gates.
 */
import {screenEchoPilotTotalBudget,type EchoPilotBudgetInput} from './pilotTotalBudgetGuard.js';
import {screenEchoTenDollarPilot,type PilotOrder} from './tenDollarPilot.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';
import {readOnlyEchoJupiterV2Swap,type EchoJupiterV2PreviewRequest,
 type EchoJupiterV2PreviewResult} from './readOnlyJupiterV2Swap.js';

export const ECHO_BUY_FIRST_LIVE_ENABLED=false as const;
export type EchoBuyFirstInput={
 order:PilotOrder;budget:EchoPilotBudgetInput;executionWallet:string;
 rpcUrl:string;jupiterApiKey:string;
 /** Verified privileged chain-wallet check, NOT a Telegram/client flag. */
 sameWalletManualExitAccessVerified:boolean;
 /** Whether operator explicitly accepts manual-app-only SELL. */
 manualExitRiskAcknowledged:boolean;
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
 if(!input.rpcUrl||!input.jupiterApiKey?.trim())return stop('MISSING_PROVIDER');
 const principal=Number(input.budget.newPrincipalCents);
 if(!Number.isSafeInteger(principal)||principal<1||principal>1000)
  return stop('INVALID_PRINCIPAL');
 const size=screenEchoTenDollarPilot(input.order,principal);
 if('reason' in size)return stop('PILOT_'+size.reason);
 const budget=screenEchoPilotTotalBudget(input.budget);
 if(!budget.eligible)return stop('BUDGET_'+budget.reason);
 try{
  const quote=await preview({
   side:'BUY',rpcUrl:input.rpcUrl,publicWallet:input.executionWallet,
   mint:input.order.mint,amountRaw:String(size.amountLamports),
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
  return {eligible:true,executable:false,reason:'BUY_PREVIEW_ONLY_NO_SIGNING',
   mode:'READ_ONLY_BUY_FIRST',buyQuoteHash:quote.unsignedTransactionSha256};
 }catch{return stop('BUY_PROVIDER_UNAVAILABLE');}
}
