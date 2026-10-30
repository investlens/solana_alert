/** Telegram callback payload interpreter for future owner-only Echo preview router.
 * Only operate on already-authenticated Telegram callback updates.
 * No bot polling, webhook, or external execution is implemented here.
 */
export type TelegramPreviewAction={action:'BUY'|'SELL';mint:string;amountSol?:0.05|0.1;sellPercent?:50|100};
const mintPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const ECHO_PREVIEW_CALLBACK_PREFIX='echo_preview:';
export function parseOwnerPreviewCallback(
  callbackData:string,
  senderId:number,
  chatId:number,
  ownerChatId:string,
):{ok:true;request:TelegramPreviewAction}|{ok:false;reason:string}{
  if(!Number.isSafeInteger(senderId)||!Number.isSafeInteger(chatId)||
    String(senderId)!==ownerChatId||String(chatId)!==ownerChatId)
    return {ok:false,reason:'OWNER_ONLY_PRIVATE_CHAT'};
  const match=/^echo_preview:(b05|b10|s50|s100):([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(callbackData);
  if(!match||!mintPattern.test(match[2]))return {ok:false,reason:'INVALID_CALLBACK'};
  const mint=match[2],code=match[1];
  if(code==='b05')return {ok:true,request:{action:'BUY',mint,amountSol:0.05}};
  if(code==='b10')return {ok:true,request:{action:'BUY',mint,amountSol:0.1}};
  if(code==='s50')return {ok:true,request:{action:'SELL',mint,sellPercent:50}};
  return {ok:true,request:{action:'SELL',mint,sellPercent:100}};
}
export function echoPreviewButtons(mint:string){
 if(!mintPattern.test(mint))throw Error('INVALID_MINT');
 // Explicitly say PREVIEW; never misrepresent these as executable trades.
 return {inline_keyboard:[
  [{text:'🧪 Preview buy 0.05 SOL',callback_data:'echo_preview:b05:'+mint},
   {text:'🧪 Preview buy 0.1 SOL',callback_data:'echo_preview:b10:'+mint}],
  [{text:'🧪 Preview sell 50%',callback_data:'echo_preview:s50:'+mint},
   {text:'🧪 Preview sell 100%',callback_data:'echo_preview:s100:'+mint}]
 ]};
}
export const ECHO_CALLBACK_BROADCAST_ALLOWED=false as const;
