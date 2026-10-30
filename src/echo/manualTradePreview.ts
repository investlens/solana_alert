/** Read-only manual trade preview, NEVER an execution authorization. */
import { validateSecureEchoBuy, type SecureEchoBuy } from './secureBuyGuard.js';
import { LIVE_EXECUTION_ENABLED, AUTO_SELL_ENABLED } from './liveBuyPolicy.js';
export type ManualPreview = { kind:'BUY_PREVIEW'; admissibleForSimulation:boolean; executionEnabled:false;
  reason:string; reservationKey:string|null; requestedSol:number; plannedTotalLamports:number|null };
export function previewEchoManualBuy(input:SecureEchoBuy, adminAuthorized:boolean,
  tokenPreviouslyReserved:boolean):ManualPreview {
  const base={kind:'BUY_PREVIEW' as const,executionEnabled:false as const,
    requestedSol:input.event.amountSol};
  if(!adminAuthorized)return {...base,admissibleForSimulation:false,reason:'ADMIN_UNAUTHORIZED',
    reservationKey:null,plannedTotalLamports:null};
  if(tokenPreviouslyReserved)return {...base,admissibleForSimulation:false,reason:'TOKEN_ALREADY_RESERVED',
    reservationKey:null,plannedTotalLamports:null};
  const decision=validateSecureEchoBuy(input);
  if(!decision.allowed)return {...base,admissibleForSimulation:false,reason:decision.reason,
    reservationKey:null,plannedTotalLamports:null};
  return {...base,admissibleForSimulation:true,reason:'SIMULATION_ONLY_LIVE_DISABLED',
    reservationKey:decision.reservationKey,plannedTotalLamports:decision.totalReservedLamports};
}
export function previewEchoManualSell(input:{adminAuthorized:boolean;percent:25|50|100;
  confirmedTokenBalance:boolean;freshSellQuote:boolean;simulationPassed:boolean;}){
  const safe=input.adminAuthorized&&input.confirmedTokenBalance&&input.freshSellQuote&&input.simulationPassed
    &&[25,50,100].includes(input.percent);
  return {kind:'SELL_PREVIEW' as const,executionEnabled:false as const,
    admissibleForSimulation:safe,reason:!input.adminAuthorized?'ADMIN_UNAUTHORIZED':
      !safe?'SELL_ROUTE_OR_BALANCE_UNVERIFIED':'SIMULATION_ONLY_LIVE_DISABLED',
    autoSellEnabled:AUTO_SELL_ENABLED&&LIVE_EXECUTION_ENABLED};
}
