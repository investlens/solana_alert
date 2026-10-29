/** Isolated paper-only admission and trade ledger. No signer, RPC submission or production reservation writes. */
import { reserveEchoPaperIntent, type EchoReservationStore } from './paperReservation.js';
import type { SecureEchoBuy } from './secureBuyGuard.js';
export type EchoPaperTrade = { reservationKey:string; callerWallet:string; mint:string; sourceSignature:string; stakeUsd:number; entryPriceUsd:number; quantity:number; openedAtMs:number; status:'OPEN'|'CLOSED'; exitPriceUsd?:number; pnlUsd?:number };
export class EchoPaperTradeEngine {
  private readonly seen=new Set<string>();
  private readonly trades:EchoPaperTrade[]=[];
  private readonly store:EchoReservationStore={insertOnce:async row=>{const key=row.executionWallet+':'+row.mint;if(this.seen.has(key))return false;this.seen.add(key);return true;}};
  constructor(private readonly stakeUsd=10){if(!Number.isFinite(stakeUsd)||stakeUsd<=0)throw Error('INVALID_PAPER_STAKE');}
  get records():readonly EchoPaperTrade[]{return this.trades.map(x=>({...x}));}
  async observe(input:SecureEchoBuy,entryPriceUsd:number){
    if(!Number.isFinite(entryPriceUsd)||entryPriceUsd<=0)return {accepted:false as const,reason:'INVALID_ENTRY_PRICE'};
    const reservation=await reserveEchoPaperIntent(input,this.store);
    if(!reservation.reserved)return {accepted:false as const,reason:reservation.reason};
    const trade:EchoPaperTrade={reservationKey:reservation.key,callerWallet:input.event.callerWallet,mint:input.event.mint,sourceSignature:input.event.transactionSignature,stakeUsd:this.stakeUsd,entryPriceUsd,quantity:this.stakeUsd/entryPriceUsd,openedAtMs:input.nowMs,status:'OPEN'};
    this.trades.push(trade);
    return {accepted:true as const,trade:{...trade}};
  }
  close(reservationKey:string,exitPriceUsd:number){
    if(!Number.isFinite(exitPriceUsd)||exitPriceUsd<0)return {closed:false as const,reason:'INVALID_EXIT_PRICE'};
    const trade=this.trades.find(x=>x.reservationKey===reservationKey&&x.status==='OPEN');
    if(!trade)return {closed:false as const,reason:'TRADE_NOT_OPEN'};
    trade.status='CLOSED';trade.exitPriceUsd=exitPriceUsd;trade.pnlUsd=trade.quantity*exitPriceUsd-trade.stakeUsd;
    return {closed:true as const,trade:{...trade}};
  }
}
