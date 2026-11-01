/** Echo auto-BUY latency research replay. All quote and simulation durations
 * are hypothetical input measurements, not actual transaction execution.
 * Never fetches quotes, signs, reserves, sends Solana RPC or authorizes trade.
 */
import {screenEchoAutoBuyShadow,type EchoAutoBuyShadowInput,
 type EchoAutoBuyShadowResult} from './autoBuyShadowGate.js';
export type EchoAutoBuyDryRunInput=Omit<EchoAutoBuyShadowInput,
 'nowMs'|'quoteAtMs'|'verifiedAtMs'|'unsignedSimulationPassed'> & {
 observedAtMs:number;verificationFinishedAtMs:number;
 hypotheticalQuoteBuildMs:number;hypotheticalSimulationMs:number;
 simulationWouldPass:boolean;
};
export type EchoAutoBuyDryRunResult={
 verdict:EchoAutoBuyShadowResult;
 hypotheticalEndToEndMs:number;
 budgetRemainingMs:number;
 quoteBuildMs:number;simulationMs:number;
 assumptions:'HYPOTHETICAL_READ_ONLY';signed:false;broadcast:false;
};
const LIMIT=3_000;
export function replayEchoAutoBuyDryRun(x:EchoAutoBuyDryRunInput):EchoAutoBuyDryRunResult {
 if(![x.observedAtMs,x.verificationFinishedAtMs,x.hypotheticalQuoteBuildMs,
   x.hypotheticalSimulationMs].every(Number.isSafeInteger)||
   x.hypotheticalQuoteBuildMs<0||x.hypotheticalSimulationMs<0||
   x.observedAtMs<x.callerTradeAtMs||
   x.verificationFinishedAtMs<x.observedAtMs)
  throw Error('INVALID_LATENCY_EVIDENCE');
 const quoteAtMs=x.verificationFinishedAtMs+x.hypotheticalQuoteBuildMs;
 const nowMs=quoteAtMs+x.hypotheticalSimulationMs;
 const verdict=screenEchoAutoBuyShadow({...x,
  nowMs,verifiedAtMs:x.verificationFinishedAtMs,quoteAtMs,
  unsignedSimulationPassed:x.simulationWouldPass});
 const elapsed=nowMs-x.callerTradeAtMs;
 return {verdict,hypotheticalEndToEndMs:elapsed,
  budgetRemainingMs:LIMIT-elapsed,
  quoteBuildMs:x.hypotheticalQuoteBuildMs,
  simulationMs:x.hypotheticalSimulationMs,
  assumptions:'HYPOTHETICAL_READ_ONLY',signed:false,broadcast:false};
}
