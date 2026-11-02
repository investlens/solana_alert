// @ts-nocheck - one-shot, read-only SDK quote + unsigned simulation diagnostic.
// NO PRIVATE KEYS, NO RPC send, NO execution, NO signed bytes or source data emitted.
// Standalone SDK install only in isolated CI, never the live AlphaOS process.
import {Connection,PublicKey,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import BN from 'bn.js';
const RPC='https://api.mainnet-beta.solana.com';
const WSOL='So11111111111111111111111111111111111111112';
const WALLET='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const A='qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump';
const B='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const P1='8zBr6K8wxVy8SmkEkYNtZWSpfwnQYWE7S1ATSMa7D1WY';
const P2='JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8';
const AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const INPUT=25_000_000;
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
const report:any={mode:'MAINNET_OFFICIAL_TWO_HOP_QUOTE_SIMULATION',
 sdk:'@pump-fun/pump-sdk/swap@4.3.1',
 amountLamports:INPUT,maxSlippageBps:1000,
 targetMint:B,quotedOutputRaw:null,minOutputRaw:null,
 poolAccountsRead:false,quoteVerified:false,additionalFeesFullyVerified:false,
 unsignedConstructed:false,simulationAttempted:false,simulationPassed:false,
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
 const ixs=await PUMP_AMM_SDK.multiHopSwapInstructions({
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
 for(const ix of ixs){
  if(ix.programId.equals(SystemProgram.programId)){
   const raw=Buffer.from(ix.data);
   if(raw.length>=12&&raw.readUInt32LE(0)===2)
    systemTransferLamports+=raw.readBigUInt64LE(4);
  }
 }
 if(systemTransferLamports>BigInt(INPUT)+10_000_000n)
  throw Error('EXCESSIVE_SOL_TRANSFER_INSTRUCTIONS');
 const bh=await con.getLatestBlockhash('confirmed');
 const message=new TransactionMessage({
  payerKey:pub(WALLET),recentBlockhash:bh.blockhash,instructions:ixs
 }).compileToV0Message();
 const tx=new VersionedTransaction(message);
 if(message.addressTableLookups.length!==0||tx.signatures.length!==1||
   tx.signatures[0].some(v=>v!==0))throw Error('UNSAFE_SIGNER_OR_ALT');
 report.unsignedConstructed=true;
 report.instructionCount=ixs.length;report.unsignedBytes=tx.serialize().length;
 report.systemTransferLamports=systemTransferLamports.toString();
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
 const networkFee=await con.getFeeForMessage(message,'confirmed');
 const walletBalance=await con.getBalance(pub(WALLET),'confirmed');
 if(!Number.isSafeInteger(ataRentUpperBound)||ataRentUpperBound<=0||
    !Number.isSafeInteger(networkFee?.value)||networkFee.value<=0)
   throw Error('RPC_NETWORK_FEE_OR_RENT_UNVERIFIED');
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
 report.fullWalletDebitVerified=false;
 report.balanceCoversProvisionalDebit=BigInt(walletBalance)>=provisionalDebitCeiling;
 report.provisionalShortfallLamports=walletBalance<Number(provisionalDebitCeiling)?
   (provisionalDebitCeiling-BigInt(walletBalance)).toString():'0';
 // Never attempt a known-insufficient unsigned simulation. This does not
 // certify complete fees: missing CPI rent must still be audited separately.
 if(!report.balanceCoversProvisionalDebit)throw Error('INSUFFICIENT_PROVISIONAL_BALANCE');
 // Safe numeric fault classification, never a transaction-data or secret dump.
 // A positive provisional balance check is NOT a fully audited wallet debit.
 report.networkFeeIncludesMessagePriorityFee=true;
 report.cpiRentAndExtraWalletDebitsAudited=false;
 report.fundingRequirementLamports=null;
 report.fundingApproved=false;
 report.simulationFailureKind=null;

 // Third-party output is not sufficient to claim actual wallet balance, ATA
 // rents or all-in USD eligibility; simulation failure remains a safe result.
 report.stage='RPC_SIMULATE_UNSIGNED';
 report.simulationAttempted=true;
 const simulated=await con.simulateTransaction(tx,{
  sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'
 });
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
 report.reason='SIMULATION_PASSED_BUT_ECONOMICS_UNAUTHORIZED';
}catch(e){
 const x=e instanceof Error?e.message:'UNKNOWN';
 const allowedReasons=['INCOMPLETE_POOL_OR_FEE_STATE','POOL_OWNER_NOT_VERIFIED',
 'POOL_MINT_CONTINUITY_FAILED','MISSING_FEE_AWARE_MIN_OUTPUT',
 'BAD_INSTRUCTION_SHAPE','UNREVIEWED_SWAP_INSTRUCTIONS',
 'EXCESSIVE_SOL_TRANSFER_INSTRUCTIONS','UNSAFE_SIGNER_OR_ALT',
 'INSUFFICIENT_PROVISIONAL_BALANCE','SIMULATION_FAILED_OR_UNFUNDED_WALLET','RPC_ENDPOINT_NOT_ALLOWLISTED',
 'RPC_METHOD_NOT_READONLY','RPC_CALL_LIMIT_REACHED'];
 report.reason=allowedReasons.includes(x)?x:'SDK_QUOTE_OR_SIMULATION_FAILED';
 report.errorType=e instanceof Error?e.name:'UNKNOWN';
}
report.rpcRequests=requests;
process.stdout.write('ECHO_TWO_HOP_QUOTE_SIM '+JSON.stringify(report)+'\n');
// A simulation OK is still not permission to trade. In this diagnostic job
// exit zero only when quote exists and unsigned simulation has actually passed.
if(!report.simulationPassed)process.exitCode=1;
