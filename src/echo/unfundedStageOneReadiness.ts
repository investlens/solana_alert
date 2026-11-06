/** Stage 1: strictly unfunded PumpSwap readiness, never an execution permit.
 * Every positive result is based on independent, exact-message evidence.
 * No provisional CPI guesses or self-reported success booleans can authorize
 * funding, signing, deployment, or a live trade.
 */
import {createHash} from 'node:crypto';
import {VersionedTransaction} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {assessPumpFundingReadiness,type PumpFundingEvidence}
 from './pumpFundingReadiness.js';

export const ECHO_UNFUNDED_STAGE_ONE_CAN_FUND=false as const;
export const ECHO_UNFUNDED_STAGE_ONE_CAN_SIGN=false as const;
export const ECHO_UNFUNDED_STAGE_ONE_CAN_BROADCAST=false as const;
export type EchoUnfundedStageOneInput={
 unsignedBytes:Uint8Array;
 expectedSha256:string;
 expectedMint:string;
 exactProtocolAccountsIndependentlyVerified:boolean;
 allCpiEffectsIndependentlyDecoded:boolean;
 exactFeeAndPriorityQuoteVerified:boolean;
 rentAndTokenAccountOwnersVerified:boolean;
 independentManualExitQuoteAndReserveVerified:boolean;
 signerNoBroadcastIntegrationPassed:boolean;
 atomicDatabaseConcurrencyPassed:boolean;
 currentCiPassed:boolean;
 funding:PumpFundingEvidence;
};
export type EchoUnfundedStageOneResult={
 status:'UNFUNDED_STAGE_ONE_BLOCKED'|'UNFUNDED_STAGE_ONE_REVIEWED';
 completed:boolean;
 missing:string[];
 unsignedSha256:string|null;
 provisionalUnsignedAttemptFloorLamports:string|null;
 fullyVerifiedFundingRequirementLamports:string|null;
 canFund:false;canSign:false;canBroadcast:false;
};
export function assessEchoUnfundedStageOne(x:EchoUnfundedStageOneInput):EchoUnfundedStageOneResult{
 const missing:string[]=[];
 let hash:string|null=null;
 try{
  if(x.unsignedBytes.length<80||x.unsignedBytes.length>3072||
     !/^[0-9a-f]{64}$/.test(x.expectedSha256))throw Error('bad message');
  const exact=createHash('sha256').update(x.unsignedBytes).digest('hex');
  if(exact!==x.expectedSha256)throw Error('changed bytes');
  const tx=VersionedTransaction.deserialize(x.unsignedBytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
     tx.message.header.numRequiredSignatures!==1||tx.signatures.length!==1||
     !tx.signatures[0].every(b=>b===0)||
     tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
    throw Error('foreign signer');
  hash=exact;
 }catch{missing.push('EXACT_UNSIGNED_PUMPSWAP_BYTES_AND_SIGNER');}
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.expectedMint))
  missing.push('VALID_TARGET_MINT');
 const checks=[
  [x.exactProtocolAccountsIndependentlyVerified,'INDEPENDENT_POOL_PROGRAM_MINT_AND_ACCOUNT_OWNERS'],
  [x.allCpiEffectsIndependentlyDecoded,'INDEPENDENT_FULL_CPI_AND_TOKEN_BALANCE_PROVENANCE'],
  [x.exactFeeAndPriorityQuoteVerified,'EXACT_NETWORK_AND_PRIORITY_FEE_BOUNDS'],
  [x.rentAndTokenAccountOwnersVerified,'VERIFIED_ATA_RENT_AND_ACCOUNT_OWNERS'],
  [x.independentManualExitQuoteAndReserveVerified,'INDEPENDENT_MANUAL_PHANTOM_EXIT_RESERVE'],
  [x.signerNoBroadcastIntegrationPassed,'NO_BROADCAST_SIGNER_INTEGRATION_PASS'],
  [x.atomicDatabaseConcurrencyPassed,'DISPOSABLE_POSTGRES_CONCURRENCY_PASS'],
  [x.currentCiPassed,'CURRENT_COMMIT_CI_PASS']
 ] as const;
 for(const [ok,reason] of checks)if(ok!==true)missing.push(reason);
 const funding=assessPumpFundingReadiness(x.funding);
 if(!x.funding.fullPumpCpiAndRentAudited||
    !x.funding.manualSellSimulationVerified||
    funding.fullyVerifiedFundingRequirementLamports===null)
  missing.push('FULLY_BOUNDED_FUNDING_ENVELOPE');
 // Stage 1 is only a test of the evidence. The wallet-funded simulation,
 // owner's funding approval and real signed/discarded trial are Stage 2+.
 return {status:missing.length===0?'UNFUNDED_STAGE_ONE_REVIEWED':'UNFUNDED_STAGE_ONE_BLOCKED',
  completed:missing.length===0,missing,unsignedSha256:hash,
  provisionalUnsignedAttemptFloorLamports:funding.provisionalUnsignedAttemptFloorLamports,
  fullyVerifiedFundingRequirementLamports:
   missing.length===0?funding.fullyVerifiedFundingRequirementLamports:null,
  canFund:false,canSign:false,canBroadcast:false};
}
