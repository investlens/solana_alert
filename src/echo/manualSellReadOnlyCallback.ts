/** Owner-only Telegram manual SELL READ-ONLY preflight.
 * Must be called ONLY by the existing authenticated Telegram update consumer.
 * Never starts a second polling/webhook consumer; never signs or broadcasts.
 * A live executor must obtain a separate one-time signed owner authorization
 * and re-verify balances, route and reservations in the isolated signer.
 */
import {PublicKey} from '@solana/web3.js';
import {parseOwnerPreviewCallback} from './telegramManualPreview.js';
import {readOnlyEchoJupiterV2Swap,
 type EchoJupiterV2PreviewRequest,type EchoJupiterV2PreviewResult}
 from './readOnlyJupiterV2Swap.js';
import {verifyEchoExecutionWallet} from './executionWallet.js';

export const ECHO_TELEGRAM_MANUAL_SELL_EXECUTION_ENABLED=false as const;
export type EchoVerifiedSellPosition={
 wallet:string;mint:string;heldPositionConfirmed:boolean;
 tokenBalanceRaw:string;balanceObservedAtMs:number;
 existingSellReservation:boolean;tokenDecimals:number;
};
export interface EchoTrustedSellPositionReader {
 getPosition(wallet:string,mint:string):Promise<EchoVerifiedSellPosition|null>;
}
export interface EchoSellCallbackReplayStore {
 /** Durable DB or single-consumer journal; returns false on duplicate callback IDs. */
 consumeOnce(callbackId:string):Promise<boolean>;
}
export type EchoTelegramSellCallback={
 id:string;from:{id:number};message?:{chat:{id:number}};data?:string;
};
export type EchoSellCallbackResult={
 accepted:boolean;reason:string;mode:'READ_ONLY_NO_SIGNING';
 previewHash?:string;percent?:50|100;
};
type PreviewFn=(req:EchoJupiterV2PreviewRequest)=>Promise<EchoJupiterV2PreviewResult>;
export function createEchoManualSellReadOnlyHandler(args:{
 ownerChatId:string;executionWallet:string;
 rpcUrl:string;jupiterApiKey:string;
 positionReader:EchoTrustedSellPositionReader;
 replayStore:EchoSellCallbackReplayStore;
 preview?:PreviewFn;clock?:()=>number;
}){
 return async(callback:EchoTelegramSellCallback):Promise<EchoSellCallbackResult>=>{
  const deny=(reason:string):EchoSellCallbackResult=>({
   accepted:false,reason,mode:'READ_ONLY_NO_SIGNING'});
  if(!callback.id||callback.id.length>128||!callback.message||
     typeof callback.data!=='string')return deny('INVALID_TELEGRAM_CALLBACK');
  // Even authorized payloads cannot authorize execution. Identity here is
  // meaningful ONLY when callback came from trusted Telegram webhook router.
  const parsed=parseOwnerPreviewCallback(
   callback.data,callback.from.id,callback.message.chat.id,args.ownerChatId);
  if(!parsed.ok)return deny('OWNER_ONLY_PRIVATE_CHAT');
  if(parsed.request.action!=='SELL')return deny('MANUAL_SELL_ONLY');
  if(!verifyEchoExecutionWallet(args.executionWallet))return deny('EXECUTION_WALLET_MISMATCH');
  if(!args.rpcUrl||!args.jupiterApiKey?.trim())return deny('READ_ONLY_PROVIDER_UNAVAILABLE');
  const now=(args.clock??Date.now)();
  if(!Number.isSafeInteger(now))return deny('UNVERIFIED_TIME');
  const mint=parsed.request.mint,percent=parsed.request.sellPercent!;
  let position:EchoVerifiedSellPosition|null;
  try{position=await args.positionReader.getPosition(args.executionWallet,mint);}
  catch{return deny('TRUSTED_POSITION_UNAVAILABLE');}
  if(!position||position.wallet!==args.executionWallet||
     position.mint!==mint||!position.heldPositionConfirmed||
     position.existingSellReservation||
     !Number.isSafeInteger(position.balanceObservedAtMs)||
     position.balanceObservedAtMs>now||
     now-position.balanceObservedAtMs>2000||
     !Number.isSafeInteger(position.tokenDecimals)||
     position.tokenDecimals<0||position.tokenDecimals>12||
     !/^[1-9][0-9]*$/.test(position.tokenBalanceRaw))
   return deny('POSITION_OR_BALANCE_UNVERIFIED');
  let quantity:bigint;
  try{quantity=BigInt(position.tokenBalanceRaw)*BigInt(percent)/100n;}
  catch{return deny('INVALID_SELL_QUANTITY');}
  if(quantity<=0n||quantity>BigInt(position.tokenBalanceRaw)||
     quantity>999999999999999999n)return deny('INVALID_SELL_QUANTITY');
  // Consume callback before network read: a time-out or uncertain outcome
  // must NOT silently allow a second execution intent.
  try{
   if(!await args.replayStore.consumeOnce(callback.id))return deny('DUPLICATE_CALLBACK');
  }catch{return deny('CALLBACK_REPLAY_STORAGE_UNAVAILABLE');}
  let result:EchoJupiterV2PreviewResult;
  try{result=await (args.preview??(r=>readOnlyEchoJupiterV2Swap(r)))({
   side:'SELL',rpcUrl:args.rpcUrl,publicWallet:args.executionWallet,
   mint,amountRaw:String(quantity),maxSlippageBps:1000,
   jupiterApiKey:args.jupiterApiKey
  });}catch{return deny('SELL_QUOTE_SIMULATION_UNAVAILABLE');}
  if(!result.ok)return deny('SELL_PREVIEW_'+result.reason);
  if(result.side!=='SELL'||result.inputMint!==mint||
     result.outputMint!=='So11111111111111111111111111111111111111112'||
     result.inputRaw!==String(quantity)||
     !/^[1-9][0-9]*$/.test(result.quotedOutputRaw)||
     !result.unsignedAudit?.feeEstimateComplete||
     result.unsignedAudit.feePayer!==args.executionWallet||
     !Number.isSafeInteger(result.unitsConsumed)||(result.unitsConsumed??0)<=0)
   return deny('SELL_QUOTE_EVIDENCE_INCOMPLETE');
  return {accepted:true,reason:'SELL_SIMULATED_NO_TRANSACTION_SENT',
   mode:'READ_ONLY_NO_SIGNING',
   previewHash:result.unsignedTransactionSha256,percent};
 };
}
