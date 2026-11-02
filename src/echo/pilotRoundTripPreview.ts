/** Composite Echo BUY + manual SELL preflight. Never reserves, signs, or broadcasts.
 * Uses independently sourced read-only swap previews and existing pilot gates.
 * A successful response is diagnostic only: actual live execution needs a trusted
 * signer, durable atomic ledger, freshly rebuilt transactions and receipt checks.
 */
import {screenEchoPilotTotalBudget,type EchoPilotBudgetInput}
  from './pilotTotalBudgetGuard.js';
import {screenEchoTenDollarPilot,type PilotOrder}
  from './tenDollarPilot.js';
import {screenEchoManualSell,type EchoManualSellRequest}
  from './manualSellAdmission.js';
import {readOnlyEchoJupiterV2Swap,
 type EchoJupiterV2PreviewRequest,type EchoJupiterV2PreviewResult}
  from './readOnlyJupiterV2Swap.js';

export const ECHO_PILOT_ROUND_TRIP_PREVIEW_EXECUTABLE=false as const;
type PreviewFn=(args:EchoJupiterV2PreviewRequest)=>Promise<EchoJupiterV2PreviewResult>;
export type PilotReadOnlyPlan={
 order:PilotOrder;
 budget:EchoPilotBudgetInput;
 executionWallet:string;
 rpcUrl:string;
 jupiterApiKey:string;
 /** Verified independently from on-chain holdings; never assume expected BUY tokens. */
 heldTokenAmountRaw:string;
 manualSell:EchoManualSellRequest;
};
export type PilotReadOnlyPlanResult={
 ok:boolean;reason:string;mode:'READ_ONLY';executable:false;
 buySimulationPassed:boolean;sellSimulationPassed:boolean;
 buyQuoteHash:string|null;sellQuoteHash:string|null;
};
export async function previewEchoPilotRoundTrip(
 plan:PilotReadOnlyPlan,
 preview:PreviewFn=readOnlyEchoJupiterV2Swap
):Promise<PilotReadOnlyPlanResult>{
 const result=(reason:string,buy=false,sell=false,buyHash:string|null=null,
  sellHash:string|null=null):PilotReadOnlyPlanResult=>({
   ok:reason==='ROUND_TRIP_PREVIEW_ONLY',reason,mode:'READ_ONLY',executable:false,
   buySimulationPassed:buy,sellSimulationPassed:sell,
   buyQuoteHash:buyHash,sellQuoteHash:sellHash
 });
 const order=screenEchoTenDollarPilot(plan.order);
 if('reason' in order)return result('PILOT_'+order.reason);
 const budget=screenEchoPilotTotalBudget(plan.budget);
 if(!budget.eligible)return result('BUDGET_'+budget.reason);
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(plan.executionWallet)||
    !plan.rpcUrl||!plan.jupiterApiKey?.trim())return result('EXECUTION_IDENTITY_OR_PROVIDER_MISSING');
 // SELL authorization belongs to the real Telegram callback path; this is an
 // independent preview screening, not authentication of a live interaction.
 if(plan.manualSell.mint!==plan.order.mint||
    plan.manualSell.percent!==100||
    plan.manualSell.verifiedTokenBalanceRaw!==plan.heldTokenAmountRaw)
  return result('SELL_POSITION_MISMATCH');
 const sell=screenEchoManualSell(plan.manualSell);
 if('reason' in sell)return result('SELL_'+sell.reason);
 if(!/^[1-9][0-9]*$/.test(plan.heldTokenAmountRaw))return result('SELL_AMOUNT_UNVERIFIED');
 const base={rpcUrl:plan.rpcUrl,publicWallet:plan.executionWallet,
  mint:plan.order.mint,maxSlippageBps:300,jupiterApiKey:plan.jupiterApiKey};
 try{
  const buy=await preview({...base,side:'BUY',amountRaw:String(order.amountLamports)});
  if(!buy.ok)return result('BUY_'+buy.reason);
  if(buy.side!=='BUY'||buy.inputRaw!==String(order.amountLamports)||
     buy.outputMint!==plan.order.mint||!buy.unsignedAudit?.feeEstimateComplete||
     buy.unsignedAudit.feePayer!==plan.executionWallet||
     !Number.isSafeInteger(buy.unitsConsumed)||(buy.unitsConsumed??0)<=0)
   return result('BUY_PREVIEW_EVIDENCE_INCOMPLETE');
  const sellQuote=await preview({...base,side:'SELL',amountRaw:plan.heldTokenAmountRaw});
  if(!sellQuote.ok)return result('SELL_'+sellQuote.reason,true,false,buy.unsignedTransactionSha256);
  if(sellQuote.side!=='SELL'||sellQuote.inputMint!==plan.order.mint||
     sellQuote.inputRaw!==plan.heldTokenAmountRaw||
     !sellQuote.unsignedAudit?.feeEstimateComplete||
     sellQuote.unsignedAudit.feePayer!==plan.executionWallet||
     !Number.isSafeInteger(sellQuote.unitsConsumed)||(sellQuote.unitsConsumed??0)<=0)
   return result('SELL_PREVIEW_EVIDENCE_INCOMPLETE',true,false,buy.unsignedTransactionSha256);
  return result('ROUND_TRIP_PREVIEW_ONLY',true,true,buy.unsignedTransactionSha256,
   sellQuote.unsignedTransactionSha256);
 }catch{return result('READ_ONLY_PROVIDER_FAILED');}
}
