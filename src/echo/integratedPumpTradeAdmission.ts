/** Full, single-entry no-broadcast Echo admission path.
 *
 * SOURCE -> independent on-chain caller signer/net token credit ->
 * separately trusted BUY economics, market cap, FX and exit quote ->
 * exact unsigned SDK message -> pinned signer-owned account/quote preflights
 * -> atomic source-signature reservation -> authenticated signer review.
 *
 * The signer-owned preflights currently cannot prove all CPI/token effects
 * or Phantom manual SELL. Consequently this can only return BLOCKED for
 * real live evidence, not authorize a transaction by using synthetic flags.
 * No signing, broadcaster, private key or Telegram side effects here.
 */
import type {EchoSignal} from './signals.js';
import {inspectIndependentlyVerifiedLiveCaller,
 type EchoTrustedPumpQuoteProvider} from './liveCallerPumpQuoteIngress.js';
import type {EchoPinnedCallerRpc} from './independentCallerReceipt.js';
import {prepareEchoPumpNoBroadcastBridge,
 type EchoPumpBridgeInput,type EchoPumpBridgeResult}
 from './pumpNoBroadcastBridge.js';
import {perCallKey} from './perCallSignerAdmissionV2.js';
import {discoverEchoCanonicalPumpTwoHop,
 type EchoCanonicalPumpRouteSdk,type EchoCanonicalPumpRouteRpc}
 from './signerOwnedCanonicalPumpRoute.js';
import {previewEchoPumpFullSell,type EchoSellPreviewRpc}
 from './signerOwnedPumpFullSellPreview.js';
import type {EchoOfficialPumpSdkAdapter}
 from './signerOwnedOfficialPumpQuote.js';

export const ECHO_INTEGRATED_PUMP_CAN_SIGN=false as const;
export const ECHO_INTEGRATED_PUMP_CAN_BROADCAST=false as const;
export type EchoIntegratedPumpInput={
 signal:EchoSignal;
 now:()=>number;
 websocketObservedAtMs:number|null;
 historicalReplay:boolean;
 callerRpc:EchoPinnedCallerRpc;
 trustedProvider:EchoTrustedPumpQuoteProvider|null;
 /** Required signer-owned canonical route derivation and real pool snapshot. */
 canonicalRoute?:{
  rpc:EchoCanonicalPumpRouteRpc;
  sdk:EchoCanonicalPumpRouteSdk;
  intermediateMint:string;
 };
 /** Entire currently held token balance, obtained from a signer-owned RPC.
  * A reverse SELL quote is evidence of routability, not Phantom approval.
  */
 sellPreview?:{
  rpc:EchoSellPreviewRpc;
  sdk:EchoOfficialPumpSdkAdapter;
  verifiedFullWalletTokenBalanceRaw:string;
 };
 /** Must be a pinned signer-side durable read, independent of Telegram. */
 ownerAutoBuyEnabled:()=>Promise<boolean>;
 /** The signer-owned exact message, authenticated request, persistent DB
  * nonce/reservation and both independent RPC preflights are required.
  */
 bridge:Omit<EchoPumpBridgeInput,'source'|'now'|
   'manualAutoBuyEnabled'|'ownerAutoBuyStillEnabled'>|null;
};
export type EchoIntegratedPumpResult={
 status:'BLOCKED'|'NO_BROADCAST_REVIEW';
 reason:string;stage:'OWNER'|'RECEIPT_AND_QUOTE'|'SIGNER_PREFLIGHT'|
  'RESERVATION_AND_SIGNER';
 bridge:EchoPumpBridgeResult|null;
 canSign:false;canBroadcast:false;canDeploy:false;
};
const block=(reason:string,stage:EchoIntegratedPumpResult['stage'],
 bridge:EchoPumpBridgeResult|null=null):EchoIntegratedPumpResult=>({
 status:'BLOCKED',reason,stage,bridge,
 canSign:false,canBroadcast:false,canDeploy:false
});
export async function reviewIntegratedEchoPumpBuy(
 x:EchoIntegratedPumpInput):Promise<EchoIntegratedPumpResult>{
 let ownerOn=false;
 try{ownerOn=await x.ownerAutoBuyEnabled();}
 catch{return block('OWNER_STATE_UNAVAILABLE','OWNER');}
 if(!ownerOn)return block('OWNER_AUTO_BUY_OFF','OWNER');
 if(x.historicalReplay||x.websocketObservedAtMs===null)
  return block('HISTORICAL_REPLAY_NOT_TRADABLE','RECEIPT_AND_QUOTE');
 // Do not reserve or invoke the signer without all independently pinned
 // preflights. Reject while the production quote adapter is missing.
 if(!x.trustedProvider)return block('TRUSTED_ECONOMICS_PROVIDER_NOT_CONNECTED',
  'RECEIPT_AND_QUOTE');
 if(!x.bridge?.signerOwnedPoolPreflight||
    !x.bridge.signerOwnedOfficialQuotePreflight||!x.canonicalRoute||
    !x.sellPreview)
  return block('SIGNER_OWNED_PUMPSWAP_PREFLIGHT_REQUIRED','SIGNER_PREFLIGHT');
 const nowMs=x.now();
 const observed=await inspectIndependentlyVerifiedLiveCaller({
  signal:x.signal,nowMs,verifiedAtMs:nowMs,
  websocketObservedAtMs:x.websocketObservedAtMs,
  historicalReplay:false,rpc:x.callerRpc,provider:x.trustedProvider
 });
 if(!observed.source)return block(observed.reason,'RECEIPT_AND_QUOTE');
 const c=observed.source.call,r=x.bridge.signerRequest;
 const route=await discoverEchoCanonicalPumpTwoHop({
  rpc:x.canonicalRoute.rpc,sdk:x.canonicalRoute.sdk,
  intermediateMint:x.canonicalRoute.intermediateMint,targetMint:c.mint
 });
 if('reason' in route)return block('CANONICAL_ROUTE_'+route.reason,'SIGNER_PREFLIGHT');
 const official=x.bridge.signerOwnedOfficialQuotePreflight;
 const pool=x.bridge.signerOwnedPoolPreflight;
 if(official.firstPool!==route.firstPool||
    official.secondPool!==route.secondPool||
    official.intermediateMint!==route.intermediateMint||
    pool.targetMint!==route.targetMint||
    pool.sdkDerivedPools.length!==2||
    pool.sdkDerivedPools[0]!==route.firstPool||
    pool.sdkDerivedPools[1]!==route.secondPool)
  return block('SIGNER_REQUEST_ROUTE_NOT_CANONICAL','SIGNER_PREFLIGHT');
 // A transaction-compatible route may be previewed using the official
 // SDK. Without complete extra CPI/rent bounds and actual Phantom app
 // validation it cannot yet justify a BUY or release reserved exit SOL.
 const sell=await previewEchoPumpFullSell({
  rpc:x.sellPreview.rpc,sdk:x.sellPreview.sdk,
  targetMint:c.mint,firstPool:route.firstPool,secondPool:route.secondPool,
  verifiedFullWalletTokenBalanceRaw:x.sellPreview.verifiedFullWalletTokenBalanceRaw,
  slippageBps:c.maxSlippageBps
 });
 if('reason' in sell)
  return block('FULL_SELL_ROUTE_'+sell.reason,'SIGNER_PREFLIGHT');
 if(!sell.fullRentCpiAndPhantomAppVerified)
  return block('COMPLETE_PHANTOM_SELL_AND_CPI_PROOF_MISSING',
   'SIGNER_PREFLIGHT');
 if(c.executionWallet!==r.executionWallet||
    c.callerWallet!==r.callerWallet||
    c.sourceSignature!==r.sourceSignature||c.mint!==r.mint||
    perCallKey(c)!==r.reservationKey||
    x.bridge.signerOwnedPoolPreflight.targetMint!==r.mint)
  return block('INDEPENDENT_CALL_AND_SIGNER_IDENTITY_MISMATCH',
   'SIGNER_PREFLIGHT');
 const reviewed=await prepareEchoPumpNoBroadcastBridge({
  ...x.bridge,source:{getVerifiedBuyAndQuote:async()=>observed.source!},
  now:x.now,manualAutoBuyEnabled:true,
  ownerAutoBuyStillEnabled:x.ownerAutoBuyEnabled
 });
 if(reviewed.status!=='REVIEWED_NO_BROADCAST')
  return block(reviewed.reason,'RESERVATION_AND_SIGNER',reviewed);
 return {status:'NO_BROADCAST_REVIEW',reason:reviewed.reason,
  stage:'RESERVATION_AND_SIGNER',bridge:reviewed,
  canSign:false,canBroadcast:false,canDeploy:false};
}
