// @ts-nocheck - one-shot, read-only SDK quote + unsigned simulation diagnostic.
// NO PRIVATE KEYS, NO RPC send, NO execution, NO signed bytes or source data emitted.
// Standalone SDK install only in isolated CI, never the live AlphaOS process.
import {Connection,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import BN from 'bn.js';
import {writeFileSync} from 'node:fs';
const RPC='https://api.mainnet-beta.solana.com';
const WSOL='So11111111111111111111111111111111111111112';
const WALLET='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const A='qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump';
const B='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const P1='8zBr6K8wxVy8SmkEkYNtZWSpfwnQYWE7S1ATSMa7D1WY';
const P2='JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8';
const AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
let INPUT=25_000_000;
const MAX_REQUESTS=20;
let requests=0;
const allowed=new Set(['getMultipleAccounts','getAccountInfo','getLatestBlockhash',
  'getMinimumBalanceForRentExemption','getFeeForMessage','getBalance','simulateTransaction']);
const fetcher:typeof fetch=(async(input:any,init:any)=>{
 if(![RPC,RPC+'/'].includes(String(input)))throw Error('RPC_ENDPOINT_NOT_ALLOWLISTED');
 const body=JSON.parse(String(init?.body??'{}'));
 const batch=Array.isArray(body)?body:[body];
 if(batch.length>10||batch.some(q=>!allowed.has(q.method)))
  throw Error('RPC_METHOD_NOT_READONLY');
 requests+=batch.length;
 if(requests>MAX_REQUESTS)throw Error('RPC_CALL_LIMIT_REACHED');
 return fetch(input,init);
}) as typeof fetch;
const report:any={mode:'MAINNET_FIVE_USD_SCENARIO_UNSIGNED_QUOTE',
 sdk:'@pump-fun/pump-sdk/swap@4.3.1',
 amountLamports:INPUT,maxSlippageBps:1000,
 targetMint:B,quotedOutputRaw:null,minOutputRaw:null,
 poolAccountsRead:false,quoteVerified:false,additionalFeesFullyVerified:false,
 unsignedConstructed:false,unsignedTransactionSha256:null,
 simulationAttempted:false,simulationPassed:false,
 fullWalletDebitVerified:false,possibleCpiRentUnknown:true,
 signed:false,broadcast:false,signingApproved:false,
 outputMintMarketCapEligible:false,reason:'NOT_VERIFIED'};
try{
 const {OnlinePumpAmmSdk,multiHopSwapQuote,PUMP_AMM_SDK}=await import('@pump-fun/pump-sdk/swap');
 const pub=(s:string)=>new PublicKey(s);
 const con=new Connection(RPC,{commitment:'confirmed',fetch:fetcher});
 report.stage='POOL_AND_FEE_CONFIG_READ';
 const online=new OnlinePumpAmmSdk(con);
 const snapshot=await online.multiHopPoolHops([pub(P1),pub(P2)]);
 const hops=snapshot?.hops;
 if(!Array.isArray(hops)||hops.length!==2||!snapshot.globalConfig||
   !snapshot.feeConfig)throw Error('INCOMPLETE_POOL_OR_FEE_STATE');
 // Also independently verify both actual pool base/quote mints and owners.
 const infos=await con.getMultipleAccountsInfo([pub(P1),pub(P2)]);
 if(infos.length!==2||infos.some(x=>!x||!x.owner.equals(pub(AMM))))
  throw Error('POOL_OWNER_NOT_VERIFIED');
 const d1=PUMP_AMM_SDK.decodePool(infos[0]),d2=PUMP_AMM_SDK.decodePool(infos[1]);
 if(!d1.baseMint.equals(pub(A))||!d1.quoteMint.equals(pub(WSOL))||
   !d2.baseMint.equals(pub(B))||!d2.quoteMint.equals(pub(A))||
   d1.isMayhemMode||d2.isMayhemMode)
  throw Error('POOL_MINT_CONTINUITY_FAILED');
 report.poolAccountsRead=true;
 report.stage='OFFICIAL_MULTI_HOP_QUOTE';
 const quoted=multiHopSwapQuote({
  inMint:pub(WSOL),hops,amountIn:new BN(INPUT),slippage:10,
  globalConfig:snapshot.globalConfig,feeConfig:snapshot.feeConfig
 });
 const minOut=quoted?.minAmountOut;
 if(!minOut||!BN.isBN(minOut)||minOut.lte(new BN(1)))
  throw Error('MISSING_FEE_AWARE_MIN_OUTPUT');
 report.minOutputRaw=minOut.toString();
 report.quotedOutputRaw=quoted?.amountOut?.toString?.()??quoted?.outputAmount?.toString?.()??null;
 report.quoteVerified=true;
 report.stage='OFFICIAL_SWAP_INSTRUCTIONS';
 let ixs=await PUMP_AMM_SDK.multiHopSwapInstructions({
  user:pub(WALLET),inMint:pub(WSOL),venues:hops,amountIn:new BN(INPUT),
  minAmountOut:minOut,globalConfig:snapshot.globalConfig
 });
 if(!Array.isArray(ixs)||ixs.length<1||ixs.length>16)
  throw Error('BAD_INSTRUCTION_SHAPE');
 const programs=ixs.map(ix=>ix.programId.toBase58());
 const permitted=new Set([AMM,'11111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ComputeBudget111111111111111111111111111111']);
 if(programs.some(p=>!permitted.has(p))||
    programs.filter(p=>p===AMM).length!==1)
  throw Error('UNREVIEWED_SWAP_INSTRUCTIONS');
 let systemTransferLamports=0n;
 let systemInstructions=0;
 for(const ix of ixs){
  if(!ix.programId.equals(SystemProgram.programId))continue;
  systemInstructions++;
  const raw=Buffer.from(ix.data);
  // A System Program instruction other than an exact Transfer is NOT priced
  // by the current audit. Reject account-creation/assign/reallocate variants
  // until their full lamport and rent effects have independent review.
  if(raw.length!==12||raw.readUInt32LE(0)!==2||ix.keys.length!==2)
   throw Error('UNPRICED_SYSTEM_INSTRUCTION');
  if(ix.keys[0]?.pubkey?.toBase58()!==WALLET)
   throw Error('UNREVIEWED_SOL_TRANSFER_SOURCE');
  systemTransferLamports+=raw.readBigUInt64LE(4);
 }
 if(systemTransferLamports!==BigInt(INPUT))
  throw Error('SYSTEM_TRANSFER_NOT_EXACT_SWAP_PRINCIPAL');
 const bh=await con.getLatestBlockhash('confirmed');
 let message=new TransactionMessage({
  payerKey:pub(WALLET),recentBlockhash:bh.blockhash,instructions:ixs
 }).compileToV0Message();
 let tx=new VersionedTransaction(message);
 const {createHash}=await import('node:crypto');
 // This hash binds the exact SDK-built unsigned transaction to a future
 // signer-side independent audit. It is not an execution authorization.
 report.unsignedTransactionSha256=createHash('sha256').update(tx.serialize()).digest('hex');
 report.pumpSwapProgram=AMM;
 report.pumpSwapRoute='TWO_HOP_SOL_INTERMEDIATE_TARGET';
 if(message.addressTableLookups.length!==0||tx.signatures.length!==1||
   tx.signatures[0].some(v=>v!==0))throw Error('UNSAFE_SIGNER_OR_ALT');
 report.unsignedConstructed=true;
 report.instructionCount=ixs.length;report.unsignedBytes=tx.serialize().length;
 report.systemTransferLamports=systemTransferLamports.toString();
 report.systemInstructionCount=systemInstructions;
 report.systemTransfersPayerAndPrincipalReviewed=true;
 // Program CPI debits remain UNKNOWN: top-level System transfers alone
 // cannot certify full wallet debit, even with exact principal and rent.
 report.cpiWalletDebitsIndependentlyVerified=false;
 // Read-only fee and account-creation estimate. ATA rent is conservatively
 // represented using 1024-byte token-account rent; CPI-created state remains
 // UNKNOWN until successful simulation or exact independently audited program.
 report.stage='RPC_FEE_AND_ATA_RENT_AUDIT';
 const ataProgram='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
 const ataKeys=[...new Set(ixs.filter(ix=>ix.programId.toBase58()===ataProgram)
   .map(ix=>ix.keys?.[1]?.pubkey?.toBase58?.()).filter(Boolean))];
 const ataAccounts=ataKeys.length?await con.getMultipleAccountsInfo(ataKeys.map(pub)):[];
 const missingAtaCount=ataAccounts.filter(x=>!x).length;
 const ataRentUpperBound=await con.getMinimumBalanceForRentExemption(1024,'confirmed');
 let networkFee=await con.getFeeForMessage(message,'confirmed');
 const walletBalance=await con.getBalance(pub(WALLET),'confirmed');
 if(!Number.isSafeInteger(ataRentUpperBound)||ataRentUpperBound<=0||
    !Number.isSafeInteger(networkFee?.value)||networkFee.value<=0)
   throw Error('RPC_NETWORK_FEE_OR_RENT_UNVERIFIED');
 // This is a DIAGNOSTIC SCENARIO using operator-supplied USD price and
 // an unverified CPI allowance. It is NOT a verified $5 trade or funding quote.
 let priceRaw=process.env.ECHO_SCENARIO_SOL_USD_CENTS;
 const cpiRaw=process.env.ECHO_SCENARIO_CPI_ALLOWANCE_LAMPORTS;
 report.publicFxCrosscheckPassed=false;
 report.publicFxExchangeTickTimestampVerified=false;
 report.publicFxTradeAuthorization=false;
 if(process.env.ECHO_SCENARIO_USE_PUBLIC_FX==='true'){
  const {parseCoinbaseSolUsdProduct,parseKrakenSolUsdTicker,
    crossCheckSolUsdPublicQuotes}=await import('../src/echo/solUsdIndependentPrice.js');
  const sources=[
   {source:'coinbase' as const,
    url:'https://api.coinbase.com/api/v3/brokerage/market/products/SOL-USD',
    parse:parseCoinbaseSolUsdProduct},
   {source:'kraken' as const,
    url:'https://api.kraken.com/0/public/Ticker?pair=SOLUSD',
    parse:parseKrakenSolUsdTicker}
  ];
  const observed=await Promise.all(sources.map(async s=>{
   try{
    const response=await fetch(s.url,{headers:{Accept:'application/json'},
     signal:AbortSignal.timeout(2500),redirect:'error'});
    if(!response.ok)return null;
    const cents=s.parse(await response.json());
    return cents?{source:s.source,cents,receivedAtMs:Date.now()}:null;
   }catch{return null;}
  }));
  const cross=crossCheckSolUsdPublicQuotes(observed.filter(x=>x!==null),Date.now());
  if(!cross.ok)throw Error('PUBLIC_SOL_USD_CROSSCHECK_FAILED');
  priceRaw=cross.upperCents;
  report.publicFxCrosscheckPassed=true;
  report.publicFxSourceCount=2;
  report.publicFxDivergenceBps=cross.divergenceBps;
  report.publicFxObservedAtMs=cross.observedAtMs;
  report.publicFxExchangeTickTimestampVerified=false;
  report.publicFxTradeAuthorization=false;
 }
 if(!priceRaw||!cpiRaw||!/^[1-9][0-9]{0,8}$/.test(priceRaw)||
    !/^[1-9][0-9]{0,12}$/.test(cpiRaw))
  throw Error('SCENARIO_PRICE_AND_CPI_ALLOWANCE_REQUIRED');
 const price=BigInt(priceRaw),cpiAllowance=BigInt(cpiRaw);
 const ataAllowance=BigInt(missingAtaCount)*BigInt(ataRentUpperBound);
 const maxInput=500n*1000000000n/price-BigInt(networkFee.value)-
  ataAllowance-cpiAllowance;
 if(maxInput<=0n||maxInput>100000000n)
  throw Error('SCENARIO_FEES_EXHAUST_ENTRY');
 INPUT=Number(maxInput);
 report.amountLamports=INPUT;
 report.scenarioSolUsdCents=priceRaw;
 report.scenarioSolUsdIndependentlyVerified=false;
 report.scenarioSolUsdPublicTwoSourceCrosschecked=report.publicFxCrosscheckPassed;
 report.scenarioCpiAllowanceLamports=cpiRaw;
 report.scenarioCpiIndependentlyVerified=false;
 report.stage='DYNAMIC_FIVE_USD_QUOTE_AND_REBUILD';
 const q=multiHopSwapQuote({
  inMint:pub(WSOL),hops,amountIn:new BN(INPUT),slippage:10,
  globalConfig:snapshot.globalConfig,feeConfig:snapshot.feeConfig
 });
 const min=q?.minAmountOut;
 if(!min||!BN.isBN(min)||min.lte(new BN(1)))
  throw Error('DYNAMIC_MIN_OUTPUT_MISSING');
 const rebuilt=await PUMP_AMM_SDK.multiHopSwapInstructions({
  user:pub(WALLET),inMint:pub(WSOL),venues:hops,
  amountIn:new BN(INPUT),minAmountOut:min,globalConfig:snapshot.globalConfig
 });
 if(!Array.isArray(rebuilt)||rebuilt.length<1||rebuilt.length>16||
    rebuilt.filter(ix=>ix.programId.toBase58()===AMM).length!==1||
    rebuilt.some(ix=>!permitted.has(ix.programId.toBase58())))
  throw Error('DYNAMIC_UNREVIEWED_INSTRUCTIONS');
 let transfer=0n;
 let transferInstructions=0;
 for(const ix of rebuilt){
  if(!ix.programId.equals(SystemProgram.programId))continue;
  const raw=Buffer.from(ix.data);
  if(raw.length!==12||raw.readUInt32LE(0)!==2||
     ix.keys.length!==2||ix.keys[0].pubkey.toBase58()!==WALLET)
    throw Error('DYNAMIC_UNREVIEWED_SYSTEM_TRANSFER');
  transferInstructions++;
  transfer+=raw.readBigUInt64LE(4);
 }
 if(transferInstructions!==1||transfer!==BigInt(INPUT))
  throw Error('DYNAMIC_TRANSFER_MISMATCH');
 const revisedAta=[...new Set(rebuilt.filter(ix=>ix.programId.toBase58()===ataProgram)
   .map(ix=>ix.keys?.[1]?.pubkey?.toBase58?.()).filter(Boolean))];
 if(revisedAta.length!==ataKeys.length||revisedAta.some(a=>!ataKeys.includes(a)))
  throw Error('DYNAMIC_ATA_SET_CHANGED');
 const revisedMessage=new TransactionMessage({
  payerKey:pub(WALLET),recentBlockhash:bh.blockhash,instructions:rebuilt
 }).compileToV0Message();
 if(revisedMessage.addressTableLookups.length!==0||
    revisedMessage.header.numRequiredSignatures!==1)
  throw Error('DYNAMIC_UNSAFE_SIGNER');
 const revisedFee=await con.getFeeForMessage(revisedMessage,'confirmed');
 if(!Number.isSafeInteger(revisedFee?.value)||revisedFee.value<=0||
    revisedFee.value>networkFee.value)
  throw Error('DYNAMIC_FEE_REQUOTE_REQUIRED');
 ixs=rebuilt;message=revisedMessage;tx=new VersionedTransaction(message);
 networkFee=revisedFee;
 report.dynamicFiveUsdInputConstructed=true;
 report.quotedOutputRaw=q?.amountOut?.toString?.()??
  q?.outputAmount?.toString?.()??null;
 report.minOutputRaw=min.toString();
 report.unsignedTransactionSha256=createHash('sha256').update(tx.serialize()).digest('hex');
 report.instructionCount=ixs.length;
 report.unsignedBytes=tx.serialize().length;
 report.systemTransferLamports=transfer.toString();
 report.systemInstructionCount=transferInstructions;
 report.fiveUsdScenarioTotalWithAssumedCpiLamports=
  String(BigInt(INPUT)+BigInt(networkFee.value)+ataAllowance+cpiAllowance);
 report.fiveUsdScenarioAllInCents=String(
  (BigInt(report.fiveUsdScenarioTotalWithAssumedCpiLamports)*price+
   999999999n)/1000000000n);
 if(BigInt(report.fiveUsdScenarioAllInCents)>500n)
  throw Error('DYNAMIC_USD_CAP_EXCEEDED');
 report.realWalletDebitVerified=false;
 report.verifiedFundingRequirementLamports=null;
 // Export exact SDK-built UNSIGNED transaction only for ephemeral CI test.
 // This does NOT verify CPI allowances, manual SELL or wallet solvency.
 if(process.env.ECHO_EXPORT_UNSIGNED_FOR_SIGNER_TEST==='true'){
  writeFileSync('.echo-isolated-unsigned-payload.json',JSON.stringify({
   version:1,mode:'EXACT_UNSIGNED_SDK_SCENARIO_NOT_EXECUTABLE',
   unsignedBase64:Buffer.from(tx.serialize()).toString('base64'),
   unsignedSha256:report.unsignedTransactionSha256,
   wallet:WALLET,firstPool:P1,secondPool:P2,
   intermediateMint:A,targetMint:B,
   principalLamports:String(INPUT),slippageBps:1000,
   scenarioCpiAudited:false,manualSellReserveVerified:false
  }),{encoding:'utf8',mode:0o600,flag:'wx'});
  report.testOnlyUnsignedPayloadCreated=true;
 }

 report.signingApproved=false;

 const auditedDebitLowerBound=BigInt(INPUT)+BigInt(networkFee.value);
 const provisionalDebitCeiling=auditedDebitLowerBound+
   BigInt(missingAtaCount)*BigInt(ataRentUpperBound);
 report.ataInstructions=ataKeys.length;
 report.missingAtaCount=missingAtaCount;
 report.ataRentConservativePerAccountLamports=ataRentUpperBound;
 report.networkBaseFeeLamports=networkFee.value;
 report.currentWalletLamports=walletBalance;
 report.knownDebitFloorLamports=auditedDebitLowerBound.toString();
 report.provisionalDebitWithAtaRentLamports=provisionalDebitCeiling.toString();
 // This is strictly a lower/provisional accounting envelope: a CPI
 // can debit the signer without appearing as a top-level System transfer.
 report.provisionalWalletDebitIsFinal=false;
 report.fullWalletDebitVerified=false;
 report.balanceCoversProvisionalDebit=BigInt(walletBalance)>=provisionalDebitCeiling;
 report.provisionalShortfallLamports=BigInt(walletBalance)<provisionalDebitCeiling?
   (provisionalDebitCeiling-BigInt(walletBalance)).toString():'0';
 report.networkFeeIncludesMessagePriorityFee=true;
 report.cpiRentAndExtraWalletDebitsAudited=false;
 report.fundingRequirementLamports=null;
 report.fundingApproved=false;
 report.simulationFailureKind=null;
 // Never attempt a known-insufficient unsigned simulation. This does not
 // certify complete fees: missing CPI rent must still be audited separately.
 if(!report.balanceCoversProvisionalDebit)throw Error('INSUFFICIENT_PROVISIONAL_BALANCE');
 // Safe numeric fault classification, never a transaction-data or secret dump.
 // A positive provisional balance check is NOT a fully audited wallet debit.

 // Third-party output is not sufficient to claim actual wallet balance, ATA
 // rents or all-in USD eligibility; simulation failure remains a safe result.
 report.stage='RPC_SIMULATE_UNSIGNED';
 report.simulationAttempted=true;
 // Explicitly request the actual fee payer post-simulation account.
 // Without this independent RPC field there is NO measured real-wallet debit.
 const simulated=await con.simulateTransaction(tx,{
  sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed',
  accounts:{encoding:'base64',addresses:[WALLET]}
 });
 report.simulatedWalletAccountReturned=false;
 report.simulatedWalletPostLamports=null;
 report.simulatedWalletDebitLamports=null;
 const payerAfter=simulated.value?.accounts?.[0];
 if(payerAfter&&Number.isSafeInteger(payerAfter.lamports)&&
     payerAfter.lamports>=0&&payerAfter.owner===SystemProgram.programId.toBase58()){
  report.simulatedWalletAccountReturned=true;
  report.simulatedWalletPostLamports=payerAfter.lamports;
  if(payerAfter.lamports<=walletBalance)
   report.simulatedWalletDebitLamports=String(BigInt(walletBalance)-BigInt(payerAfter.lamports));
 }
 report.unitsConsumed=simulated.value?.unitsConsumed??null;
 report.simulationPassed=simulated.value?.err===null;
 if(!report.simulationPassed) {
  // Fail-closed category only. Retain no full RPC error, transaction bytes,
  // signer material, or simulation logs in stdout.
  const err=simulated.value?.err;
  report.simulationFailureKind=err===null?'UNKNOWN':
    typeof err==='string'?err.replace(/[^a-zA-Z_]/g,'').slice(0,40):
    err&&typeof err==='object'?Object.keys(err).slice(0,2).join('_'):'UNKNOWN';
  throw Error('SIMULATION_FAILED_OR_UNFUNDED_WALLET');
 }
 if(!report.simulatedWalletAccountReturned||report.simulatedWalletDebitLamports===null)
  throw Error('SIMULATED_PAYER_BALANCE_EVIDENCE_MISSING');
 report.reason='SIMULATION_PASSED_BUT_CPI_AND_EXIT_UNVERIFIED';
}catch(e){
 const x=e instanceof Error?e.message:'UNKNOWN';
 const allowedReasons=['INCOMPLETE_POOL_OR_FEE_STATE','POOL_OWNER_NOT_VERIFIED',
 'POOL_MINT_CONTINUITY_FAILED','MISSING_FEE_AWARE_MIN_OUTPUT',
 'BAD_INSTRUCTION_SHAPE','UNREVIEWED_SWAP_INSTRUCTIONS',
 'EXCESSIVE_SOL_TRANSFER_INSTRUCTIONS','UNPRICED_SYSTEM_INSTRUCTION',
 'UNREVIEWED_SOL_TRANSFER_SOURCE','SYSTEM_TRANSFER_NOT_EXACT_SWAP_PRINCIPAL','UNSAFE_SIGNER_OR_ALT',
 'INSUFFICIENT_PROVISIONAL_BALANCE','SIMULATION_FAILED_OR_UNFUNDED_WALLET','RPC_ENDPOINT_NOT_ALLOWLISTED',
 'RPC_METHOD_NOT_READONLY','RPC_CALL_LIMIT_REACHED',
 'SIMULATED_PAYER_BALANCE_EVIDENCE_MISSING','SCENARIO_PRICE_AND_CPI_ALLOWANCE_REQUIRED',
 'SCENARIO_FEES_EXHAUST_ENTRY','DYNAMIC_MIN_OUTPUT_MISSING',
 'DYNAMIC_UNREVIEWED_INSTRUCTIONS','DYNAMIC_UNREVIEWED_SYSTEM_TRANSFER',
 'DYNAMIC_TRANSFER_MISMATCH','DYNAMIC_ATA_SET_CHANGED','DYNAMIC_UNSAFE_SIGNER',
 'DYNAMIC_FEE_REQUOTE_REQUIRED','DYNAMIC_USD_CAP_EXCEEDED',
 'PUBLIC_SOL_USD_CROSSCHECK_FAILED'];
 report.reason=allowedReasons.includes(x)?x:'SDK_QUOTE_OR_SIMULATION_FAILED';
 report.errorType=e instanceof Error?e.name:'UNKNOWN';
}
report.rpcRequests=requests;
process.stdout.write('ECHO_TWO_HOP_QUOTE_SIM '+JSON.stringify(report)+'\n');
// A simulation OK is still not permission to trade. In this diagnostic job
// exit zero only when quote exists and unsigned simulation has actually passed.
if(!report.simulationPassed)process.exitCode=1;
