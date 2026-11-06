/** Package 3: no-broadcast integrated release gate.
 * Never converts synthetic approval booleans into real BUY authorization.
 * Combines the independently reviewed cost envelope and ALL open-lot exit
 * reserve and requires evidence of the production signer path.
 */
import type {EchoDebitEnvelopeResult} from './signerDebitEnvelope.js';
import type {EchoPortfolioExitResult} from './portfolioExitReserveReview.js';
export const ECHO_INTEGRATED_RELEASE_CAN_TRADE=false as const;
export type EchoIntegratedGateInput={
 entry:EchoDebitEnvelopeResult;
 exits:EchoPortfolioExitResult;
 callerBuyVerifiedOnChain:boolean;
 sourceSignatureDurablyUnique:boolean;
 atomicWalletReservationVerified:boolean;
 persistentNonceVerified:boolean;
 liveTrustedCpiAdapterVerified:boolean;
 realWalletSimulationVerified:boolean;
 realPhantomExitVerified:boolean;
 isolatedRealKeySignedAndDiscardedVerified:boolean;
 manualKillSwitchIsOff:boolean;
};
export type EchoIntegratedGateResult={
 status:'NO_BROADCAST_REVIEW'|'BLOCKED';
 passedChecks:number;requiredChecks:10;
 unresolved:string[];canSign:false;canBroadcast:false;canDeploy:false;
};
export function assessEchoIntegratedRelease(x:EchoIntegratedGateInput):EchoIntegratedGateResult{
 const checks:[
  string,boolean
 ][]=[
  ['COMPLETE_ENTRY_ECONOMICS',x.entry.ok],
  ['PORTFOLIO_EXIT_RESERVES',x.exits.ok],
  ['VERIFIED_CALLER_BUY',x.callerBuyVerifiedOnChain],
  ['DURABLE_SOURCE_UNIQUENESS',x.sourceSignatureDurablyUnique],
  ['ATOMIC_WALLET_RESERVATION',x.atomicWalletReservationVerified],
  ['DURABLE_SIGNER_NONCE',x.persistentNonceVerified],
  ['REAL_TRUSTED_CPI_PROVENANCE',x.liveTrustedCpiAdapterVerified],
  ['REAL_WALLET_SIMULATION',x.realWalletSimulationVerified],
  ['REAL_PHANTOM_SELL_VERIFIED',x.realPhantomExitVerified],
  ['REAL_SIGNED_AND_DISCARDED_PROOF',x.isolatedRealKeySignedAndDiscardedVerified]
 ];
 const unresolved=checks.filter(([,ok])=>ok!==true).map(([key])=>key);
 // Independent SELL quotes for existing lots and the entry reservation must
 // agree on an exit floor. Pending BUY commitments cannot masquerade as
 // reserved exit capital. Numeric strings are bounded and compared exactly.
 if(x.entry.ok&&x.exits.ok){
  const num=(v:string):bigint|null=>
   /^(0|[1-9][0-9]{0,17})$/.test(v)?BigInt(v):null;
  const booked=num(x.entry.exitReserveLamports);
  const allExits=num(x.exits.requiredExitReserveLamports);
  const upper=num(x.entry.upperBuyDebitLamports);
  const pending=num(x.entry.pendingCommitmentsLamports);
  const required=num(x.entry.requiredWalletLamports);
  if(booked===null||allExits===null||upper===null||
     pending===null||required===null||
     booked<allExits||required!==upper+booked+pending)
   unresolved.push('ENTRY_EXIT_RESERVE_RECONCILIATION');
 }
 if(!x.manualKillSwitchIsOff)unresolved.push('ADMIN_KILL_SWITCH_ACTIVE');
 return {
  status:unresolved.length?'BLOCKED':'NO_BROADCAST_REVIEW',
  passedChecks:checks.length-checks.filter(([,ok])=>ok!==true).length,
  requiredChecks:10,unresolved,
  canSign:false,canBroadcast:false,canDeploy:false
 };
}
