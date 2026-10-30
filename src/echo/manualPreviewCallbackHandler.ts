import { parseOwnerPreviewCallback } from './telegramManualPreview.js';
import { EchoPreviewLedger } from './manualPreviewLedger.js';
import { readEchoWalletIdentity } from './readOnlySimulation.js';

/** An adapter for a future authenticated, single-consumer Telegram update
 * router. Does not poll Telegram or install a second webhook.
 * Never constructs transactions, signs, broadcasts or consumes wallet secrets.
 */
export function createEchoPreviewCallbackHandler(args:{
 ownerChatId:string; walletEnv:NodeJS.ProcessEnv; ledger:EchoPreviewLedger;
}){
 return async (callback:{
  id:string; from:{id:number}; message?:{chat:{id:number}}; data?:string;
 }):Promise<{accepted:boolean;text:string;callbackId:string}>=>{
  if(!callback.id||!callback.message||typeof callback.data!=='string')
   return {accepted:false,callbackId:callback.id,text:'Preview unavailable: invalid callback'};
  const parsed=parseOwnerPreviewCallback(callback.data,callback.from.id,callback.message.chat.id,args.ownerChatId);
  if(!parsed.ok)return {accepted:false,callbackId:callback.id,text:'Preview denied: owner-only private chat'};
  const wallet=readEchoWalletIdentity(args.walletEnv);
  if(!wallet.configured)return {accepted:false,callbackId:callback.id,text:'Preview unavailable: isolated public wallet not configured'};
  const req=parsed.request;
  try{
   const record=await args.ledger.request({
    ownerChatId:args.ownerChatId,wallet:wallet.address,mint:req.mint,
    action:req.action,...(req.action==='BUY'?{amountSol:req.amountSol}:{sellPercent:req.sellPercent})
   });
   if(!record.created)return {accepted:false,callbackId:callback.id,text:'Duplicate preview; no transaction sent'};
   return {accepted:true,callbackId:callback.id,text:'PREVIEW ONLY · '+req.action+
    ' · '+(req.action==='BUY'?req.amountSol+' SOL':req.sellPercent+'%')+
    ' · saved locally. No quote, simulation, signature or trade submitted.'};
  }catch{
   return {accepted:false,callbackId:callback.id,text:'Preview storage unavailable; nothing submitted'};
  }
 };
}
