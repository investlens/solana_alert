/** Echo dry-run coordinator: trusted server-side snapshot -> independently simulated
 * BUY and manual SELL -> atomic DB reservation -> crash-recoverable journal.
 *
 * No signing, broadcasting, private keys, or Telegram callback handler.
 * A reservation persists on uncertain or failed journal writes (fail closed).
 * The DB adapter must independently and atomically enforce wallet+mint uniqueness,
 * open-position count, total all-in USD exposure, and caller source idempotency.
 */
import type {EchoAllInPilotStore,AllInVerifiedSnapshot} from './allInPilotReservation.js';
import type {EchoTradeStateJournal} from './tradeStateJournal.js';
import type {PilotReadOnlyPlan} from './pilotRoundTripPreview.js';
import {previewEchoPilotRoundTrip} from './pilotRoundTripPreview.js';
import type {EchoJupiterV2PreviewRequest,EchoJupiterV2PreviewResult}
 from './readOnlyJupiterV2Swap.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';

export const ECHO_COORDINATOR_LIVE_EXECUTION_ENABLED=false as const;
export type EchoCoordinatorResult={
 prepared:boolean;executable:false;reason:string;reservationKey?:string;
 buySimulationPassed:boolean;sellSimulationPassed:boolean;
};
type TrustedProvider={
 /** Must originate in privileged trusted server, not Telegram payload. */
 getTrustedPlan():Promise<{plan:PilotReadOnlyPlan;callerSignature:string;proof:AllInVerifiedSnapshot}>;
};
type PreviewFn=(args:EchoJupiterV2PreviewRequest)=>Promise<EchoJupiterV2PreviewResult>;
export async function prepareEchoPilotBuyAndExit(args:{
 provider:TrustedProvider;store:EchoAllInPilotStore;
 journal:EchoTradeStateJournal;preview?:PreviewFn;
}):Promise<EchoCoordinatorResult>{
 const reject=(reason:string,buy=false,sell=false):EchoCoordinatorResult=>({
  prepared:false,executable:false,reason,buySimulationPassed:buy,sellSimulationPassed:sell
 });
 let plan:PilotReadOnlyPlan;
 let callerSignature:string;let proof:AllInVerifiedSnapshot;
 try{({plan,callerSignature,proof}=await args.provider.getTrustedPlan());}
 catch{return reject('TRUSTED_SNAPSHOT_UNAVAILABLE');}
 if(!verifyEchoExecutionWallet(plan.executionWallet))return reject('DEDICATED_WALLET_MISMATCH');
 // Validate before touching persisted positions. Quote/simulation may be costly:
 // provider and signer still need their own rate limits and atomic rechecks.
 let preflight:Awaited<ReturnType<typeof previewEchoPilotRoundTrip>>;
 try{preflight=await previewEchoPilotRoundTrip(plan,args.preview);}
 catch{return reject('READ_ONLY_PREFLIGHT_EXCEPTION');}
 if(!preflight.ok)return reject(preflight.reason,
  preflight.buySimulationPassed,preflight.sellSimulationPassed);
 const tx=callerSignature;
 // Paper preview alone is not execution authorization; prevent mutating the DB
 // if the pilot is not admitted and we cannot attest the caller's signature.
 if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(tx))
  return reject('CALLER_SIGNATURE_NOT_VERIFIED',true,true);
 let db:Awaited<ReturnType<EchoAllInPilotStore['reserveAllIn']>>;
 try{db=await args.store.reserveAllIn({plan,callerSignature:tx,proof});}
 catch{return reject('ATOMIC_RESERVATION_DATABASE_UNAVAILABLE',true,true);}
 if('reason' in db)return reject('ATOMIC_RESERVATION_'+db.reason,true,true);
 // DB reserves the mint for good. If the process loses connectivity before
 // journal persistence, this remains held until independent reconciliation.
 try{
  const saved=await args.journal.reserve(db.key);
  if(!saved)return reject('JOURNAL_ALREADY_RESERVED_OR_UNAVAILABLE',true,true);
  const now=Date.now();
  const quoted=await args.journal.advance(db.key,{kind:'QUOTE_OK',nowMs:now});
  if(!quoted.ok)return reject('JOURNAL_QUOTE_PERSIST_FAILED',true,true);
  const simulated=await args.journal.advance(db.key,{kind:'SIMULATION_OK',nowMs:now});
  if(!simulated.ok)return reject('JOURNAL_SIMULATION_PERSIST_FAILED',true,true);
  return {prepared:true,executable:false,reason:'PREPARED_READ_ONLY_NO_SIGNING',
   reservationKey:db.key,buySimulationPassed:true,sellSimulationPassed:true};
 }catch{return reject('JOURNAL_PERSISTENCE_UNAVAILABLE_DB_RESERVATION_HELD',true,true);}
}
