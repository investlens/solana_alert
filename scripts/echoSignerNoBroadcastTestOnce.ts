/** Owner-invoked, ONE-SHOT, isolated PumpSwap proof runner.
 * Does not load ANY signer key, serve HTTP, create reservations, sign or send.
 * Requires a pre-built exact unsigned message supplied solely via an
 * operator-controlled, test-only environment. No Telegram event payloads.
 * Intended for a disposable signer TEST service, never the alert service.
 */
import {createHash} from 'node:crypto';
import {Connection,VersionedTransaction,PublicKey} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
import {probeSignerOwnedPumpRpc} from '../src/echo/signerOwnedPumpRpcProbe.js';
import {inspectSignerOwnedOfficialPumpQuote}
 from '../src/echo/signerOwnedOfficialPumpQuote.js';
import {loadSignerOwnedOfficialPumpSdk}
 from '../src/echo/loadSignerOwnedOfficialPumpSdk.js';
import {reconcileEchoSignerPumpCpiLedger}
 from '../src/echo/signerOwnedPumpCpiAccounting.js';
import {simulateSignerCompiledCpiOnPinnedRpc}
 from '../src/echo/signerOwnedCompiledCpiSimulation.js';
import {observeTokenCloseSourcesReadOnly}
 from '../src/echo/signerOwnedTokenCloseRefundEvidence.js';
import {classifyEchoRentRefundPattern}
 from '../src/echo/signerOwnedPumpRentRefundClassification.js';

export const ECHO_TEST_RUNNER_CAN_SIGN=false as const;
export const ECHO_TEST_RUNNER_CAN_BROADCAST=false as const;
type Env=Record<string,string|undefined>;
export type EchoTestRunnerResult={
 mode:'NO_BROADCAST_SIGNER_RPC_TEST';
 status:'BLOCKED'|'PROVISIONAL';
 reason:string;exactMessageHashVerified:boolean;
 poolAndQuoteVerified:boolean;
 simulatedWalletProvisional:boolean;
 payerCpiLedgerReconciled:boolean;
 provisionalWalletBalanceLamports?:string;
 provisionalWalletDebitUpperLamports?:string;
 provisionalNetworkFeeLamports?:string;
 provisionalCpiInstructionCount?:number;
 provisionalComputeUnitsConsumed?:number|null;
 sameSimulationTokenCloseConfirmed?:boolean;
 closeSourceDiagnostic?:{state:string;lamports?:string;ownerIsSystem?:boolean;dataBytes?:number};
 rentRefundClassification?:{
  status:'RENT_PATTERN_MATCHED_NOT_AUDITED'|'RENT_PATTERN_NOT_PROVEN';
  reason:string;inferredRentLamports?:string;
  conservativeDebitUpperLamports?:string;
  independentlyAuditedRefund:false;payerCpiLedgerReconciled:false;
  signingAllowed:false;broadcastAllowed:false
 };
 tokenCloseRentHypothesis?:{
  classification:'RENT_AND_NETWORK_FEE_MATCH'|'RENT_OR_FEE_DOES_NOT_MATCH'|'UNVERIFIED_RENT_RPC';
  referenceAccountBytes:165;
  rpcMinimumRentLamports?:string;
  observedRefundGapLamports:string;
  reportedNetworkFeeLamports:string;
  candidateTopLevelCloseCount:number;
  exactBankRefundProven:false;
  canSign:false;canBroadcast:false
 };
 tokenClosePrestateEvidence?:{
  status:string;sourceCount?:number;existingTokenAccounts?:number;
  observedPrestateLamports?:string;observedSlot?:number;
  exactSimulationBankMatched?:false;refundProven?:false;
  signingAllowed:false;broadcastAllowed:false;reason?:string
 };
 payerDebitMismatchDiagnostic?:{
  observedPayerDeltaLamports:string;
  outboundSystemDebitsLamports:string;
  inboundSystemCreditsLamports:string;
  networkFeeLamports:string;
  unexplainedAgainstDebitOnlyLamports:string;
  unexplainedAgainstNetSystemLamports:string;
  programInstructionsReviewed:number;
  candidateTokenCloseRefundCount:number;
  candidateTokenCloseFundedLamports:string;
  candidateTopLevelTokenCloseCount:number;
  candidateInnerTokenCloseCount:number;
 };
 completeCpiAndTokenEffectsVerified:false;
 manualPhantomExitVerified:false;
 signingAllowed:false;broadcastAllowed:false;
};
const result=(reason:string,hash=false,quote=false,sim=false):EchoTestRunnerResult=>({
 mode:'NO_BROADCAST_SIGNER_RPC_TEST',
 status:sim&&quote?'PROVISIONAL':'BLOCKED',reason,
 exactMessageHashVerified:hash,poolAndQuoteVerified:quote,
 simulatedWalletProvisional:sim,payerCpiLedgerReconciled:false,
 completeCpiAndTokenEffectsVerified:false,
 manualPhantomExitVerified:false,
 signingAllowed:false,broadcastAllowed:false
});
const address=(s:string|undefined)=>typeof s==='string'&&
 /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
// Fixed allowlist for this disposable, no-secret public-mainnet job.
// Do not permit arbitrary coordinator / Telegram / user supplied endpoints.
const urlAllowed=(s:string|undefined)=>
 s==='https://api.mainnet-beta.solana.com'||
 s==='https://api.mainnet-beta.solana.com/';

export async function runEchoSignerNoBroadcastTest(
 env:Env,createConnection:(url:string)=>Connection=url=>new Connection(url,'confirmed')
):Promise<EchoTestRunnerResult>{
 // This is deliberately not an implicit environment-trading ON switch.
 if(env.ECHO_SIGNER_TEST_ONLY!=='true'||
    env.ECHO_SIGNER_BROADCAST_ENABLED!=='false'||
    env.ECHO_SIGNER_REQUESTS_ENABLED!=='false'||
    env.ECHO_SIGNER_MODE!=='PROOF_ONLY'||
    env.ECHO_SIGNER_EXPECTED_WALLET!==ECHO_EXPECTED_EXECUTION_WALLET)
  return result('TEST_ONLY_BROADCAST_AND_CUSTODY_GUARDS_REQUIRED');
 if(!urlAllowed(env.ECHO_SIGNER_TEST_RPC_URL))
  return result('PINNED_HTTPS_RPC_ENDPOINT_REQUIRED');
 if(!env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64||
    env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64.length>8192||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64))
  return result('EXACT_UNSIGNED_TRANSACTION_REQUIRED');
 if(!address(env.ECHO_SIGNER_TEST_FIRST_POOL)||
    !address(env.ECHO_SIGNER_TEST_SECOND_POOL)||
    !address(env.ECHO_SIGNER_TEST_INTERMEDIATE_MINT)||
    !address(env.ECHO_SIGNER_TEST_TARGET_MINT)||
    !/^[1-9][0-9]{0,17}$/.test(env.ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS??'')||
    !/^(?:[1-9][0-9]{0,3})$/.test(env.ECHO_SIGNER_TEST_SLIPPAGE_BPS??''))
  return result('COMPLETE_OFFICIAL_ROUTE_CONFIG_REQUIRED');
 let bytes:Buffer,tx:VersionedTransaction,sha:string;
 try{
  bytes=Buffer.from(env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64,'base64');
  if(bytes.length<80||bytes.length>3072||
     bytes.toString('base64')!==env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64)
   return result('NONCANONICAL_OR_OVERSIZED_MESSAGE');
  sha=createHash('sha256').update(bytes).digest('hex');
  tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
     tx.message.header.numRequiredSignatures!==1||
     tx.signatures.length!==1||tx.signatures[0].some(b=>b!==0)||
     tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
   return result('WRONG_FEE_PAYER_OR_NOT_UNSIGNED');
 }catch{return result('UNREADABLE_EXACT_UNSIGNED_MESSAGE');}
 let connection:Connection;
 try{connection=createConnection(env.ECHO_SIGNER_TEST_RPC_URL!);}
 catch{return result('RPC_CONNECTION_CONFIG_FAILED',true);}
 const sdk=await loadSignerOwnedOfficialPumpSdk(connection);
 if(!sdk)return result('PINNED_OFFICIAL_PUMP_SDK_NOT_INSTALLED',true);
 const quote=await inspectSignerOwnedOfficialPumpQuote({
  rpc:connection,sdk,unsignedBytes:bytes,expectedUnsignedSha256:sha!,
  firstPool:env.ECHO_SIGNER_TEST_FIRST_POOL!,
  secondPool:env.ECHO_SIGNER_TEST_SECOND_POOL!,
  intermediateMint:env.ECHO_SIGNER_TEST_INTERMEDIATE_MINT!,
  targetMint:env.ECHO_SIGNER_TEST_TARGET_MINT!,
  principalLamports:env.ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS!,
  slippageBps:Number(env.ECHO_SIGNER_TEST_SLIPPAGE_BPS)
 });
 if('reason' in quote)return result('OFFICIAL_POOL_OR_QUOTE_'+quote.reason,true);
 let cpiSnapshot:{
  innerInstructions:unknown;payerBeforeLamports:number;
  payerAfterLamports:number;networkFeeLamports:number;simulationSlot:number
 }|null=null;
 const rpc=await probeSignerOwnedPumpRpc({
  connection:{
   getBalanceAndContext:(wallet,commitment)=>connection.getBalanceAndContext(wallet,commitment),
   getFeeForMessage:(message,commitment)=>connection.getFeeForMessage(message,commitment),
   isBlockhashValid:(blockhash,commitment)=>connection.isBlockhashValid(blockhash,{commitment}),
   simulateTransaction:(transaction,config)=>
     simulateSignerCompiledCpiOnPinnedRpc(connection,transaction,config)
  },unsignedBytes:bytes,expectedUnsignedSha256:sha!,nowMs:Date.now(),
  onValidatedSimulation:snapshot=>{cpiSnapshot=snapshot;}
 });
 if('reason' in rpc)return {
  ...result('EXACT_WALLET_SIMULATION_'+rpc.reason,true,true),
  ...(rpc.closeSourceDiagnostic?{closeSourceDiagnostic:rpc.closeSourceDiagnostic}:{})
 };
 if(!cpiSnapshot)return result('MISSING_VALIDATED_SIMULATION_SNAPSHOT',true,true);
 const snapshot=cpiSnapshot as {
  innerInstructions:unknown;payerBeforeLamports:number;
  payerAfterLamports:number;networkFeeLamports:number;simulationSlot:number
 };
 const ledger=reconcileEchoSignerPumpCpiLedger({
  unsignedBytes:bytes,expectedUnsignedSha256:sha!,
  prePayerBalanceLamports:String(snapshot.payerBeforeLamports),
  postSimulatedPayerBalanceLamports:String(snapshot.payerAfterLamports),
  networkFeeLamports:String(snapshot.networkFeeLamports),
  innerInstructions:snapshot.innerInstructions as Parameters<
   typeof reconcileEchoSignerPumpCpiLedger>[0]['innerInstructions']
 });
 if('reason' in ledger){
  const diagnostic=ledger.diagnostic;
  // Never log the private exact-message account-index array.
  const {candidateTokenCloseSourceIndexes:sourceIndexes,...publicDiagnostic}=
   diagnostic??{candidateTokenCloseSourceIndexes:undefined};
  // The post-simulation payer delta can exclude refunded token-account
  // rent while the modeled System debits include initial account funding.
  // Compare the *observed* gap plus base fee to current RPC rent for a
  // standard SPL token account (165 bytes), but DO NOT count a credit.
  let rentHypothesis:EchoTestRunnerResult['tokenCloseRentHypothesis'];
  if(diagnostic&&diagnostic.candidateTopLevelTokenCloseCount===1&&
     diagnostic.candidateTokenCloseRefundCount===1&&
     diagnostic.candidateInnerTokenCloseCount===0){
   const difference=BigInt(diagnostic.outboundSystemDebitsLamports)-
    BigInt(diagnostic.inboundSystemCreditsLamports)-
    BigInt(diagnostic.observedPayerDeltaLamports);
   const feeLamports=BigInt(diagnostic.networkFeeLamports);
   try{
    const referenceRent=await connection.getMinimumBalanceForRentExemption(
     165,'confirmed');
    if(!Number.isSafeInteger(referenceRent)||referenceRent<=0)
     throw Error('INVALID_READONLY_RENT');
    rentHypothesis={
     classification:difference+feeLamports===BigInt(referenceRent)?
      'RENT_AND_NETWORK_FEE_MATCH':'RENT_OR_FEE_DOES_NOT_MATCH',
     referenceAccountBytes:165,
     rpcMinimumRentLamports:String(referenceRent),
     observedRefundGapLamports:String(difference),
     reportedNetworkFeeLamports:String(feeLamports),
     candidateTopLevelCloseCount:1,
     exactBankRefundProven:false,canSign:false,canBroadcast:false
    };
   }catch{
    rentHypothesis={
     classification:'UNVERIFIED_RENT_RPC',referenceAccountBytes:165,
     observedRefundGapLamports:String(difference),
     reportedNetworkFeeLamports:String(feeLamports),
     candidateTopLevelCloseCount:1,
     exactBankRefundProven:false,canSign:false,canBroadcast:false
    };
   }
  }
  let evidence;
  if(sourceIndexes?.length){
   evidence=await observeTokenCloseSourcesReadOnly({
    tx,sourceIndexes,minSlot:snapshot.simulationSlot,
    rpc:{getMultipleAccountsInfoAndContext:(keys,config)=>
     connection.getMultipleAccountsInfoAndContext(keys,config)}
   });
  }
  const classification=diagnostic&&
   rentHypothesis?.classification==='RENT_AND_NETWORK_FEE_MATCH'?
   classifyEchoRentRefundPattern({
    ledgerFailureReason:ledger.reason,
    observedPayerDeltaLamports:diagnostic.observedPayerDeltaLamports,
    outboundSystemDebitsLamports:diagnostic.outboundSystemDebitsLamports,
    inboundSystemCreditsLamports:diagnostic.inboundSystemCreditsLamports,
    messageNetworkFeeLamports:diagnostic.networkFeeLamports,
    liveTokenAccountMinimumRentLamports:rentHypothesis.rpcMinimumRentLamports!,
    closeToPayerCount:diagnostic.candidateTokenCloseRefundCount,
    topLevelCloseToPayerCount:diagnostic.candidateTopLevelTokenCloseCount,
    exactSameSimulationClosedAccount:rpc.sameSimulationTokenCloseConfirmed,
    closedSourceAbsentAtLaterRpcObservation:
     evidence?.status==='CANDIDATE_PRESTATE_ONLY'&&
     evidence.existingTokenAccounts===0
   }):undefined;
  return {
   ...result('PAYER_CPI_LEDGER_'+ledger.reason,true,true),
   ...(diagnostic?{payerDebitMismatchDiagnostic:publicDiagnostic}:{}),
   ...(evidence?{tokenClosePrestateEvidence:evidence}:{}),
   ...(classification?{rentRefundClassification:classification}:{}),
   ...(rentHypothesis?{tokenCloseRentHypothesis:rentHypothesis}:{}),
   sameSimulationTokenCloseConfirmed:rpc.sameSimulationTokenCloseConfirmed
  };
 }
 // Observed payer SOL debit is reconciled; token effects, price freshness
 // and wallet-side Phantom SELL remain unverified. Never authorize trading.
 return {
  ...result('PROVISIONAL_PAYER_CPI_RECONCILED_NOT_LIVE_APPROVAL',true,true,true),
  payerCpiLedgerReconciled:true,
  provisionalWalletBalanceLamports:rpc.payerBalanceBeforeLamports,
  provisionalWalletDebitUpperLamports:ledger.conservativeWalletDebitLamports,
  provisionalNetworkFeeLamports:rpc.networkFeeEstimateLamports,
  provisionalCpiInstructionCount:rpc.innerInstructionCount,
  provisionalComputeUnitsConsumed:rpc.computeUnitsConsumed,
  sameSimulationTokenCloseConfirmed:rpc.sameSimulationTokenCloseConfirmed
 };
}

// Opt-in command only. Imported tests never start the job.
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const status=await runEchoSignerNoBroadcastTest(process.env);
 process.stdout.write('ECHO_NO_BROADCAST_SIGNER_TEST='+JSON.stringify(status)+'\n');
 if(status.status==='BLOCKED')process.exitCode=2;
}
