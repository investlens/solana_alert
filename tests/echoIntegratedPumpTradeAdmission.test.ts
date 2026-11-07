import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,type ParsedTransactionWithMeta}
 from '@solana/web3.js';
import {reviewIntegratedEchoPumpBuy,
 ECHO_INTEGRATED_PUMP_CAN_BROADCAST}
 from '../src/echo/integratedPumpTradeAdmission.js';
import {SLINGOOR_WALLET} from '../src/echo/liveBuyPolicy.js';
import type {EchoSignal} from '../src/echo/signals.js';
import type {EchoPumpBridgeInput} from '../src/echo/pumpNoBroadcastBridge.js';
const now=1800000000000;
const signature='2'.repeat(64);
const mint=Keypair.generate().publicKey.toBase58();
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const signal:EchoSignal={id:signature+':'+mint,
 signature,wallet:SLINGOOR_WALLET,caller:'WHALE · slingoor',
 timestamp:now/1000-1,mint,side:'BUY',tokenAmount:2000,
 quoteAmount:0.01,quoteSymbol:'SOL',quoteBasis:'token-account net change'};
const receipt=(signed=true)=>({
 slot:500,
 transaction:{message:{accountKeys:[{
  pubkey:new PublicKey(SLINGOOR_WALLET),signer:signed,writable:true}]}},
 meta:{err:null,preTokenBalances:[{
  accountIndex:3,mint,owner:SLINGOOR_WALLET,
  uiTokenAmount:{amount:'1000'}}],postTokenBalances:[{
  accountIndex:3,mint,owner:SLINGOOR_WALLET,
  uiTokenAmount:{amount:'3000'}}]}
}) as unknown as ParsedTransactionWithMeta;
const stubBridge=()=>({
 signerOwnedPoolPreflight:{
  targetMint:mint,connection:{} as any,sdkDerivedPools:[] as string[]
 },
 signerOwnedOfficialQuotePreflight:{
  rpc:{} as any,sdk:{} as any,firstPool:mint,secondPool:mint,
  intermediateMint:mint
 },
 signerRequest:{executionWallet:wallet,callerWallet:SLINGOOR_WALLET,
  sourceSignature:signature,mint,
  reservationKey:[wallet,SLINGOOR_WALLET,signature,mint].join(':')}
}) as unknown as EchoPumpBridgeInput;
function setUp(){
 let receiptReads=0,quoteReads=0;
 const input={
  signal,now:()=>now,websocketObservedAtMs:now-400,
  historicalReplay:false,
  ownerAutoBuyEnabled:async()=>true,
  callerRpc:{getParsedTransaction:async()=>{
   receiptReads++;return receipt();}},
  trustedProvider:{readIndependentlyVerifiedCall:async()=>{
   quoteReads++;return null;}},
  bridge:stubBridge(),
  // These tests exercise receipt/quote gating. Provide placeholders for the
  // required future preflights so the intended early stage can be reached;
  // neither is ever invoked in these negative scenarios.
  canonicalRoute:{rpc:{} as any,sdk:{} as any,intermediateMint:mint},
  sellPreview:{rpc:{} as any,sdk:{} as any,
   verifiedFullWalletTokenBalanceRaw:'1'}
 };
 return {input,counters:()=>({receiptReads,quoteReads})};
}
test('owner sleep OFF blocks before all RPC, queue and signer reads',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,ownerAutoBuyEnabled:async()=>false
 });
 assert.equal(r.reason,'OWNER_AUTO_BUY_OFF');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
 assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 assert.equal(ECHO_INTEGRATED_PUMP_CAN_BROADCAST,false);
});
test('quote provider and both signer-owned preflights are mandatory',async()=>{
 const {input,counters}=setUp();
 const missingProvider=await reviewIntegratedEchoPumpBuy({
  ...input,trustedProvider:null
 });
 assert.equal(missingProvider.reason,'TRUSTED_ECONOMICS_PROVIDER_NOT_CONNECTED');
 const missingPreflight=await reviewIntegratedEchoPumpBuy({
  ...input,bridge:null
 });
 assert.equal(missingPreflight.reason,'SIGNER_OWNED_PUMPSWAP_PREFLIGHT_REQUIRED');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
});
test('independent transaction must really be signed by caller before quotes',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,callerRpc:{getParsedTransaction:async()=>receipt(false)}
 });
 assert.equal(r.reason,'INDEPENDENT_RECEIPT_TRACKED_CALLER_DID_NOT_SIGN');
 assert.equal(r.canBroadcast,false);
 assert.equal(counters().quoteReads,0);
});
test('valid source signature and token credit cannot replace missing economic proof',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy(input);
 assert.equal(r.reason,'TRUSTED_CALLER_QUOTE_IDENTITY_MISMATCH');
 assert.equal(r.canSign,false);assert.equal(r.canBroadcast,false);
 assert.deepEqual(counters(),{receiptReads:1,quoteReads:1});
});
test('historical replay never tries a read-only RPC',async()=>{
 const {input,counters}=setUp();
 const r=await reviewIntegratedEchoPumpBuy({
  ...input,historicalReplay:true
 });
 assert.equal(r.reason,'HISTORICAL_REPLAY_NOT_TRADABLE');
 assert.deepEqual(counters(),{receiptReads:0,quoteReads:0});
});

test('integrated verified receipt -> canonical pools -> full SELL preview blocks before reservation',async()=>{
 const p1=Keypair.generate().publicKey,p2=Keypair.generate().publicKey;
 const a=Keypair.generate().publicKey;
 const amm=new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
 const wsol=new PublicKey('So11111111111111111111111111111111111111112');
 const account1={owner:amm,executable:false,data:Buffer.alloc(200),lamports:1,rentEpoch:0};
 const account2={...account1,data:Buffer.alloc(201)};
 const c={
  executionWallet:wallet,callerWallet:SLINGOOR_WALLET,mint,sourceSignature:signature,
  side:'BUY' as const,verifiedCallerSigner:true,verifiedSwap:true,
  verifiedSpend:true,verifiedTokenCredit:true,isTransferOrGift:false,
  marketCapUsd:45000,callerPriceSolPerToken:0.00001,
  buyPriceSolPerToken:0.000014,maxSlippageBps:1000,
  observedAtMs:now-1000,nowMs:now,marketCapObservedAtMs:now,
  balanceVerifiedAtMs:now,solUsdObservedAtMs:now,
  principalLamports:'20000000',networkAndPriorityFeeLamports:'50000',
  accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
  sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
  availableWalletLamports:'100000000',solUsdPriceCents:'20000',
  exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
  walletBalanceAndFxVerified:true,durableReservationAvailable:true,
  killSwitch:false,openOrPendingLots:3,sourceTransactionAlreadyReserved:false
 };
 let reservations=0;
 const bridge={
  ...stubBridge(),
  store:{reserve:async()=>{reservations++;throw Error('must not reserve');}},
  signerOwnedPoolPreflight:{connection:{} as any,targetMint:mint,
   sdkDerivedPools:[p1.toBase58(),p2.toBase58()]},
  signerOwnedOfficialQuotePreflight:{rpc:{} as any,sdk:{} as any,
   firstPool:p1.toBase58(),secondPool:p2.toBase58(),
   intermediateMint:a.toBase58()}
 };
 const result=await reviewIntegratedEchoPumpBuy({
  signal,now:()=>now,websocketObservedAtMs:now-400,
  historicalReplay:false,ownerAutoBuyEnabled:async()=>true,
  callerRpc:{getParsedTransaction:async()=>receipt()},
  trustedProvider:{readIndependentlyVerifiedCall:async()=>c},
  bridge,
  canonicalRoute:{
   intermediateMint:a.toBase58(),
   sdk:{
    canonicalPumpPoolPda:(base,quote)=>{
     if(base.equals(a)&&quote===undefined)return p1;
     if(base.toBase58()===mint&&quote?.equals(a))return p2;
     throw Error('unknown route');
    },
    decodePool:info=>info===account1?
     {baseMint:a,quoteMint:wsol,isMayhemMode:false}:
     {baseMint:new PublicKey(mint),quoteMint:a,isMayhemMode:false}
   },
   rpc:{getMultipleAccountsInfoAndContext:async()=>({
    context:{slot:100},value:[account1,account2]})}
  },
  sellPreview:{
   verifiedFullWalletTokenBalanceRaw:'1000000',
   sdk:{
    multiHopPoolHops:async()=>({
     hops:[{},{}],globalConfig:{},feeConfig:{}}),
    decodePool:()=>{throw Error('not needed');},
    quote:()=>({minAmountOut:{toString:()=> '90'},
     amountOut:{toString:()=> '100'}}),
    amount:v=>v,
    swapInstructions:async()=>[new TransactionInstruction({
     programId:amm,keys:[
      {pubkey:p1,isSigner:false,isWritable:true},
      {pubkey:p2,isSigner:false,isWritable:true},
      {pubkey:new PublicKey(mint),isSigner:false,isWritable:false}
     ],data:Buffer.from([1])
    })]
   },
   rpc:{
    getLatestBlockhash:async()=>({
     blockhash:Keypair.generate().publicKey.toBase58()}),
    getFeeForMessage:async()=>({context:{slot:100},value:5000})
   }
  }
 });
 assert.equal(result.reason,'COMPLETE_PHANTOM_SELL_AND_CPI_PROOF_MISSING',
  JSON.stringify(result));
 assert.equal(result.stage,'SIGNER_PREFLIGHT');
 assert.equal(result.canSign,false);
 assert.equal(result.canBroadcast,false);
 assert.equal(reservations,0);
});
