// @ts-nocheck — first-party multi-hop construction proof only.
// Deliberately UNTRUSTED economics (min out 1). NEVER simulate, sign, submit
// or send this transaction to an execution service. Public test wallet only.
import {Connection,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import BN from 'bn.js';
const RPC='https://api.mainnet-beta.solana.com',WSOL='So11111111111111111111111111111111111111112';
const WALLET='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const A='qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump';
const B='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const P1='8zBr6K8wxVy8SmkEkYNtZWSpfwnQYWE7S1ATSMa7D1WY';
const P2='JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8';
const AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const SPL='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
let reads=0;
const fetcher:typeof fetch=(async(url:any,opts:any)=>{
 if(![RPC,RPC+'/'].includes(String(url)))throw Error('UNREVIEWED_URL');
 const bodies=JSON.parse(String(opts.body));
 const batch=Array.isArray(bodies)?bodies:[bodies];
 if(batch.some(r=>!['getMultipleAccounts','getAccountInfo','getLatestBlockhash'].includes(r.method)))
  throw Error('UNREVIEWED_RPC_METHOD');
 reads+=batch.length;if(reads>8)throw Error('READ_LIMIT');
 return fetch(url,opts);
}) as typeof fetch;
const result:any={mode:'FIRST_PARTY_MULTI_HOP_BUILD_ONLY',
 requestedLamports:25_000_000,slippageProtected:false,
 quotedMinOutputVerified:false,routeOnChainVerified:false,
 transactionConstructed:false,simulationAttempted:false,signing:false,
 broadcast:false,executable:false,readCalls:0};
try{
 const {PUMP_SDK}=await import('@pump-fun/pump-sdk');
 const {PUMP_AMM_SDK}=await import('@pump-fun/pump-sdk/swap');
 const conn=new Connection(RPC,{commitment:'confirmed',fetch:fetcher});
 const pub=(s:string)=>new PublicKey(s);
 const info=await conn.getMultipleAccountsInfo([pub(P1),pub(P2),pub(A),pub(B)]);
 if(info.length!==4||info.some(x=>!x))throw Error('MISSING_ROUTE_ACCOUNTS');
 const [poolA,poolB,tokenA,tokenB]=info;
 if(!poolA.owner.equals(pub(AMM))||!poolB.owner.equals(pub(AMM)))throw Error('UNVERIFIED_POOL_OWNERS');
 const d1=PUMP_AMM_SDK.decodePool(poolA),d2=PUMP_AMM_SDK.decodePool(poolB);
 if(!d1.baseMint.equals(pub(A))||!d1.quoteMint.equals(pub(WSOL))||
    !d2.baseMint.equals(pub(B))||!d2.quoteMint.equals(pub(A)))
  throw Error('ROUTE_MINTS_MISMATCH');
 if(d1.isMayhemMode||d2.isMayhemMode)throw Error('MAYHEM_DISALLOWED');
 const allowedPrograms=[SPL,TOKEN2022];
 const tA=tokenA.owner.toBase58(),tB=tokenB.owner.toBase58();
 if(!allowedPrograms.includes(tA)||!allowedPrograms.includes(tB))throw Error('UNREVIEWED_TOKEN_PROGRAM');
 result.routeOnChainVerified=true;
 const hops=[
  {venue:'pool',baseMint:pub(A),quoteMint:pub(WSOL),baseTokenProgram:pub(tA),quoteTokenProgram:pub(SPL)},
  {venue:'pool',baseMint:pub(B),quoteMint:pub(A),baseTokenProgram:pub(tB),quoteTokenProgram:pub(tA)}
 ];
 // min=1 is strictly for BUILD SHAPE ONLY, NOT suitable for execution.
 const ixs=await PUMP_SDK.multiHopSwapInstructions({
  user:pub(WALLET),hops,side:'buy',amountIn:new BN(25_000_000),
  minAmountOut:new BN(1)
 });
 if(!Array.isArray(ixs)||ixs.length<1||ixs.length>15)throw Error('INVALID_BUILDER_OUTPUT');
 const programs=ixs.map(x=>x.programId.toBase58());
 const allowed=new Set([AMM,SPL,TOKEN2022,
  '11111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'ComputeBudget111111111111111111111111111111']);
 if(programs.some(x=>!allowed.has(x))||!programs.includes(AMM))
  throw Error('UNREVIEWED_PROGRAM_IN_BUILT_ROUTE');
 const bh=await conn.getLatestBlockhash('confirmed');
 const msg=new TransactionMessage({payerKey:pub(WALLET),recentBlockhash:bh.blockhash,instructions:ixs})
  .compileToV0Message();
 const tx=new VersionedTransaction(msg);
 if(tx.signatures.length!==1||tx.signatures[0].some(x=>x!==0))
  throw Error('SIGNATURE_PRESENT');
 if(msg.addressTableLookups.length>0)throw Error('UNREVIEWED_ALT');
 result.transactionConstructed=true;
 result.instructionCount=ixs.length;result.programs=programs;
 result.unsignedBytes=tx.serialize().length;
 result.reason='BUILD_ONLY_REQUIRES_REAL_PRICE_AND_FEE_QUOTE';
}catch(e){
 const message=e instanceof Error?e.message:'UNKNOWN';
 const known=['MISSING_ROUTE_ACCOUNTS','UNVERIFIED_POOL_OWNERS','ROUTE_MINTS_MISMATCH',
 'MAYHEM_DISALLOWED','UNREVIEWED_TOKEN_PROGRAM','INVALID_BUILDER_OUTPUT',
 'UNREVIEWED_PROGRAM_IN_BUILT_ROUTE','SIGNATURE_PRESENT','UNREVIEWED_ALT','READ_LIMIT'];
 result.reason=known.includes(message)?message:'SDK_OR_RPC_BUILD_FAILURE';
}
result.readCalls=reads;
process.stdout.write('ECHO_OFFICIAL_TWO_HOP '+JSON.stringify(result)+'\n');
if(!result.transactionConstructed)process.exitCode=1;
