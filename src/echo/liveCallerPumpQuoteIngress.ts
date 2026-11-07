/** Read-only live caller-to-PumpSwap trusted evidence ingress.
 * The existing Echo queue's independently parsed receipt is the entry point.
 * A real signer-owned quote/evidence provider is REQUIRED: this module never
 * fabricates market cap, SOL/USD, CPI, wallet state or manual SELL reserves.
 * It cannot reserve, sign or broadcast any transaction.
 */
import type {EchoSignal} from './signals.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from './liveBuyPolicy.js';
import {screenEchoFiveDollarCall,type EchoFiveDollarCall}
 from './fiveDollarCallPolicy.js';
import type {EchoPerCallTrustedInput} from './perCallNoBroadcastCoordinator.js';
import {verifyEchoCallerReceipt,type EchoPinnedCallerRpc}
 from './independentCallerReceipt.js';

export const ECHO_LIVE_CALLER_INGRESS_CAN_SIGN=false as const;
export const ECHO_LIVE_CALLER_INGRESS_CAN_BROADCAST=false as const;
const CALLERS=new Set([SLINGOOR_WALLET,CHAIRMAN_WALLET]);
const SIG=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export type EchoTrustedPumpQuoteProvider={
 /** Fetch the original source receipt, market cap, signer-owned current
  * wallet state, exact Pump SDK unsigned swap/CPI and Phantom exit reserve
  * independently. Provider-supplied proof flags must be validated by a
  * separate pinned RPC/signer trust boundary before any real-money use.
  */
 readIndependentlyVerifiedCall(input:{
  callerWallet:string;sourceSignature:string;mint:string;
  callerTokenCredit:number;callerQuoteDebit:number;
  callerQuoteSymbol:'SOL'|'USDC';observedAtMs:number;
 }):Promise<EchoFiveDollarCall|null>;
};
export type EchoIngressResult={
 status:'BLOCKED'|'VERIFIED_NO_BROADCAST';
 reason:string;
 source:EchoPerCallTrustedInput|null;
 canSign:false;canBroadcast:false;
};
const deny=(reason:string):EchoIngressResult=>({status:'BLOCKED',reason,
 source:null,canSign:false,canBroadcast:false});
export async function inspectLiveCallerForPumpQuote(input:{
 signal:EchoSignal;nowMs:number;verifiedAtMs:number;
 websocketObservedAtMs:number|null;
 /** A historical replay must not initiate any BUY review. */
 historicalReplay:boolean;
 provider:EchoTrustedPumpQuoteProvider|null;
}):Promise<EchoIngressResult>{
 const {signal:s}=input;
 if(input.historicalReplay)return deny('HISTORICAL_REPLAY_NO_BUY');
 if(!CALLERS.has(s.wallet)||s.side!=='BUY'||!SIG.test(s.signature)||
    !Number.isFinite(s.quoteAmount)||s.quoteAmount===null||
    s.quoteAmount<=0||!Number.isFinite(s.tokenAmount)||s.tokenAmount<=0||
    (s.quoteSymbol!=='SOL'&&s.quoteSymbol!=='USDC')||
    (s.quoteBasis!=='token-account net change'&&
     s.quoteBasis!=='wallet SOL net change; includes fees/rent')||!Number.isSafeInteger(input.nowMs)||
    !Number.isSafeInteger(input.verifiedAtMs)||
    !Number.isSafeInteger(input.websocketObservedAtMs)||
    !Number.isSafeInteger(s.timestamp)||
    s.timestamp<=0||s.timestamp*1000>input.nowMs||
    input.nowMs-s.timestamp*1000>3000||
    input.websocketObservedAtMs!>input.verifiedAtMs||
    input.verifiedAtMs>input.nowMs)
  return deny('UNVERIFIED_OR_STALE_CALLER_EVENT');
 if(!input.provider)return deny('TRUSTED_PUMP_PROVIDER_NOT_CONNECTED');
 let call:EchoFiveDollarCall|null;
 try{call=await input.provider.readIndependentlyVerifiedCall({
  callerWallet:s.wallet,sourceSignature:s.signature,mint:s.mint,
  callerTokenCredit:s.tokenAmount,callerQuoteDebit:s.quoteAmount,
  callerQuoteSymbol:s.quoteSymbol as 'SOL'|'USDC',
  observedAtMs:input.verifiedAtMs
 });}catch{return deny('TRUSTED_PUMP_PROVIDER_UNAVAILABLE');}
 if(!call||call.callerWallet!==s.wallet||
    call.sourceSignature!==s.signature||call.mint!==s.mint||
    call.side!=='BUY'||call.isTransferOrGift||
    !call.verifiedCallerSigner||!call.verifiedSwap||
    !call.verifiedSpend||!call.verifiedTokenCredit)
  return deny('TRUSTED_CALLER_QUOTE_IDENTITY_MISMATCH');
 const check=screenEchoFiveDollarCall({...call,nowMs:input.nowMs});
 if(!check.eligible)return deny('PER_CALL_POLICY_'+check.reason);
 // No transaction bytes or signing key originate in this ingress.
 return {status:'VERIFIED_NO_BROADCAST',
  reason:'TRUSTED_QUOTE_READY_FOR_OFFLINE_BRIDGE',
  source:{call:{...call,nowMs:input.nowMs},
   chainAtMs:s.timestamp*1000,
   websocketObservedAtMs:input.websocketObservedAtMs!,
   verifiedAtMs:input.verifiedAtMs},
  canSign:false,canBroadcast:false};
}

/** Release-oriented intake. Unlike the alert-only/synthetic ingress above,
 * this NEVER accepts a queue-classified BUY unless a second signer-pinned
 * Solana RPC independently verifies signer + positive token credit first.
 *
 * Full swap debit, verified market cap and exit proof are still required
 * from the separate trusted provider, not invented from the receipt.
 */
export async function inspectIndependentlyVerifiedLiveCaller(input:{
 signal:EchoSignal;nowMs:number;verifiedAtMs:number;
 websocketObservedAtMs:number|null;historicalReplay:boolean;
 rpc:EchoPinnedCallerRpc;provider:EchoTrustedPumpQuoteProvider|null;
}):Promise<EchoIngressResult>{
 if(input.historicalReplay)return deny('HISTORICAL_REPLAY_NO_BUY');
 if(!input.websocketObservedAtMs)return deny('NO_LIVE_WEBSOCKET_OBSERVATION');
 const receipt=await verifyEchoCallerReceipt({
  rpc:input.rpc,callerWallet:input.signal.wallet,
  sourceSignature:input.signal.signature,mint:input.signal.mint
 });
 if('reason' in receipt)return deny('INDEPENDENT_RECEIPT_'+receipt.reason);
 // The positive signer/token-credit receipt is not evidence of an actual
 // BUY by itself. Delegate to the separately verified swap and debit reader.
 return inspectLiveCallerForPumpQuote(input);
}
