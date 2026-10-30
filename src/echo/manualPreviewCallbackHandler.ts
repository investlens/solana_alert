import { parseOwnerPreviewCallback } from './telegramManualPreview.js';
import { EchoPreviewLedger } from './manualPreviewLedger.js';
import { readEchoWalletIdentity } from './readOnlySimulation.js';
import { readOnlyJupiterSwapPreview } from './readOnlyJupiterSwap.js';

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
   // Optional read-only BUY preflight. Disabled by default. Never run on SELL:
   // sell needs a separately verified token balance and swap builder.
   if(req.action==='BUY' && args.walletEnv.ECHO_PREVIEW_QUOTE_SIMULATION_ENABLED==='true'){
     const apiKey=args.walletEnv.ECHO_JUPITER_API_KEY?.trim();
     const rpcUrl=args.walletEnv.ECHO_SOLANA_RPC_URL?.trim();
     if(!apiKey||!rpcUrl)return {accepted:true,callbackId:callback.id,text:'PREVIEW SAVED · preflight unavailable (missing API/RPC). No trade sent.'};
     const outcome=await readOnlyJupiterSwapPreview({
       rpcUrl,publicWallet:wallet.address,outputMint:req.mint,
       amountLamports:Math.round(req.amountSol!*1e9),maxSlippageBps:100,jupiterApiKey:apiKey
     });
     await args.ledger.markSimulation(record.item.id,outcome.ok);
     return {accepted:true,callbackId:callback.id,text:outcome.ok
       ? 'PREVIEW SIMULATION PASSED · read-only, no transaction sent'
       : 'PREVIEW SIMULATION BLOCKED · '+outcome.reason+'. No transaction sent'};
   }
   return {accepted:true,callbackId:callback.id,text:'PREVIEW ONLY · '+req.action+
    ' · '+(req.action==='BUY'?req.amountSol+' SOL':req.sellPercent+'%')+
    ' · saved locally. No quote, simulation, signature or trade submitted.'};
  }catch{
   return {accepted:false,callbackId:callback.id,text:'Preview storage unavailable; nothing submitted'};
  }
 };
}
