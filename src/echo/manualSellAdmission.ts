/** Owner-authorized manual sell admission; DOES NOT sign or broadcast. */
export type EchoManualSellRequest = {
 ownerChatId:string; senderId:number; chatId:number; mint:string;
 percent:50|100; verifiedTokenBalanceRaw:string;
 heldPositionVerified:boolean; activeSellReservation:boolean;
 quoteVerified:boolean; simulationPassed:boolean;
};
export type EchoManualSellDecision = {allowed:true;percent:50|100}|{allowed:false;reason:string};
export function screenEchoManualSell(request:EchoManualSellRequest):EchoManualSellDecision {
 const reject=(reason:string):EchoManualSellDecision=>({allowed:false,reason});
 if(!/^\d+$/.test(request.ownerChatId)||String(request.senderId)!==request.ownerChatId||
    String(request.chatId)!==request.ownerChatId)return reject('OWNER_ONLY');
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(request.mint))return reject('INVALID_MINT');
 if(request.percent!==50&&request.percent!==100)return reject('INVALID_PERCENT');
 if(!request.heldPositionVerified||!/^[1-9]\d*$/.test(request.verifiedTokenBalanceRaw))
   return reject('NO_VERIFIED_POSITION');
 if(request.activeSellReservation)return reject('DUPLICATE_SELL_PENDING');
 if(!request.quoteVerified||!request.simulationPassed)return reject('SELL_ROUTE_NOT_VERIFIED');
 return {allowed:true,percent:request.percent};
}
export const ECHO_MANUAL_SELL_BROADCAST_ENABLED=false as const;
