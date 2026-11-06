// @ts-nocheck — ephemeral one-shot official SDK diagnostic only.
// Never asks for a private key. Never builds, signs or submits a BUY.
import {Connection,PublicKey} from '@solana/web3.js';
const RPC='https://api.mainnet-beta.solana.com';
const TOKEN='qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump';
const SOL='So11111111111111111111111111111111111111112';
const AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const PUMP='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
let calls=0;
const requester:typeof fetch=(async (url:any,init:any)=>{
 if(![RPC,RPC+'/'].includes(String(url)))throw Error('UNEXPECTED_HOST');
 const payload=JSON.parse(String(init.body));
 const requests=Array.isArray(payload)?payload:[payload];
 if(requests.some(r=>!['getAccountInfo','getMultipleAccounts'].includes(r.method)))
   throw Error('UNEXPECTED_METHOD');
 calls+=requests.length;
 if(calls>5)throw Error('READ_BUDGET_EXCEEDED');
 return fetch(url,init);
}) as typeof fetch;
const outcome:any={mode:'OFFICIAL_INTERMEDIATE_HOP_READ_ONLY',mint:TOKEN,
 venue:'UNVERIFIED',chainReadCount:0,signer:false,broadcast:false,simulation:false};
try{
 const {canonicalPumpPoolPda,PUMP_AMM_SDK}=await import('@pump-fun/pump-sdk/swap');
 outcome.stage='SWAP_MODULE_LOADED';
 const con=new Connection(RPC,{commitment:'confirmed',fetch:requester});
 const mint=new PublicKey(TOKEN);
 const pda=canonicalPumpPoolPda(mint);
 outcome.stage='POOL_PDA_DERIVED';
 const pool=await con.getAccountInfo(pda);
 outcome.stage='POOL_RPC_READ';
 if(pool){
  if(!pool.owner.equals(new PublicKey(AMM)))throw Error('UNEXPECTED_POOL_OWNER');
  const x=PUMP_AMM_SDK.decodePool(pool);
  if(!x.baseMint.equals(mint)||!x.quoteMint.equals(new PublicKey(SOL)))
   throw Error('FIRST_POOL_NOT_SOL_PAIRED');
  if(x.isMayhemMode)throw Error('MAYHEM_POOL_DISALLOWED');
  outcome.venue='CANONICAL_PUMPSWAP';
  outcome.pool=pda.toBase58();
  outcome.quoteMint=x.quoteMint.toBase58();
 }else{
  const {bondingCurvePda,PUMP_SDK}=await import('@pump-fun/pump-sdk');
  outcome.stage='CURVE_MODULE_LOADED';
  const bc=await con.getAccountInfo(bondingCurvePda(mint));
  if(!bc||!bc.owner.equals(new PublicKey(PUMP)))throw Error('NO_SUPPORTED_FIRST_HOP');
  const x=PUMP_SDK.decodeBondingCurve(bc);
  if(x.complete)throw Error('CURVE_COMPLETE_WITHOUT_CANONICAL_POOL');
  outcome.venue='PUMP_BONDING_CURVE';
  outcome.quoteMint=x.quoteMint?.toBase58?.()??null;
  // Pump's v2 SOL curves commonly store zero quote key; require exact
  // account/version review before accepting as valid SOL first hop.
  outcome.solQuoteVerified=outcome.quoteMint===SOL||
   outcome.quoteMint==='11111111111111111111111111111111';
  if(!outcome.solQuoteVerified)throw Error('FIRST_CURVE_NOT_SOL_PAIRED');
  if(x.isMayhemMode)throw Error('MAYHEM_CURVE_DISALLOWED');
 }
 outcome.result='VENUE_DISCOVERED_NOT_AUTHORIZED';
}catch(e){
 outcome.result='NOT_VERIFIED';
 const msg=e instanceof Error?e.message:'UNKNOWN';
 const allowed=['UNEXPECTED_POOL_OWNER','FIRST_POOL_NOT_SOL_PAIRED','MAYHEM_POOL_DISALLOWED',
 'NO_SUPPORTED_FIRST_HOP','CURVE_COMPLETE_WITHOUT_CANONICAL_POOL',
 'FIRST_CURVE_NOT_SOL_PAIRED','MAYHEM_CURVE_DISALLOWED','READ_BUDGET_EXCEEDED'];
 outcome.reason=allowed.includes(msg)?msg:'SDK_OR_RPC_UNAVAILABLE';
}
outcome.chainReadCount=calls;
process.stdout.write('ECHO_FIRST_HOP '+JSON.stringify(outcome)+'\n');
if(outcome.result!=='VENUE_DISCOVERED_NOT_AUTHORIZED')process.exitCode=1;
