import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** Isolated paper-only admission and trade ledger. No signer, RPC submission or production reservation writes. */
import { reserveEchoPaperIntent, type EchoReservationStore } from './paperReservation.js';
import type { SecureEchoBuy } from './secureBuyGuard.js';
export type EchoPaperTrade = { reservationKey:string; callerWallet:string; mint:string; sourceSignature:string; stakeUsd:number; entryPriceUsd:number; quantity:number; openedAtMs:number; status:'OPEN'|'CLOSED'; exitPriceUsd?:number; pnlUsd?:number };
export class EchoPaperTradeEngine {
  private readonly seen=new Set<string>();
  private readonly trades:EchoPaperTrade[]=[];
  private readonly store:EchoReservationStore={insertOnce:async row=>{const key=row.executionWallet+':'+row.mint;if(this.seen.has(key))return false;this.seen.add(key);return true;}};
  constructor(private readonly stakeUsd=10,private readonly journalPath?:string){
 if(!Number.isFinite(stakeUsd)||stakeUsd<=0)throw Error('INVALID_PAPER_STAKE');
 if(journalPath){try{const saved=JSON.parse(readFileSync(journalPath,'utf8')) as {version:number;trades:EchoPaperTrade[];seen:string[]};
 if(saved.version!==1||!Array.isArray(saved.trades)||!Array.isArray(saved.seen))throw Error('INVALID_PAPER_JOURNAL');
 for(const trade of saved.trades){if(typeof trade.reservationKey!=='string'||!['OPEN','CLOSED'].includes(trade.status))throw Error('INVALID_PAPER_JOURNAL');this.trades.push(trade);}
 for(const key of saved.seen){if(typeof key!=='string')throw Error('INVALID_PAPER_JOURNAL');this.seen.add(key);}
 }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 }
 private persist(){if(!this.journalPath)return;mkdirSync(dirname(this.journalPath),{recursive:true,mode:0o700});const tmp=this.journalPath+'.tmp';writeFileSync(tmp,JSON.stringify({version:1,trades:this.trades,seen:[...this.seen]}),{mode:0o600});renameSync(tmp,this.journalPath);}

  get records():readonly EchoPaperTrade[]{return this.trades.map(x=>({...x}));}
  async observe(input:SecureEchoBuy,entryPriceUsd:number){
    if(!Number.isFinite(entryPriceUsd)||entryPriceUsd<=0)return {accepted:false as const,reason:'INVALID_ENTRY_PRICE'};
    const reservation=await reserveEchoPaperIntent(input,this.store);
    if(!reservation.reserved)return {accepted:false as const,reason:reservation.reason};
    const trade:EchoPaperTrade={reservationKey:reservation.key,callerWallet:input.event.callerWallet,mint:input.event.mint,sourceSignature:input.event.transactionSignature,stakeUsd:this.stakeUsd,entryPriceUsd,quantity:this.stakeUsd/entryPriceUsd,openedAtMs:input.nowMs,status:'OPEN'};
    this.trades.push(trade);
    this.persist();
    return {accepted:true as const,trade:{...trade}};
  }
  close(reservationKey:string,exitPriceUsd:number){
    if(!Number.isFinite(exitPriceUsd)||exitPriceUsd<0)return {closed:false as const,reason:'INVALID_EXIT_PRICE'};
    const trade=this.trades.find(x=>x.reservationKey===reservationKey&&x.status==='OPEN');
    if(!trade)return {closed:false as const,reason:'TRADE_NOT_OPEN'};
    trade.status='CLOSED';trade.exitPriceUsd=exitPriceUsd;trade.pnlUsd=trade.quantity*exitPriceUsd-trade.stakeUsd;
    this.persist();
    return {closed:true as const,trade:{...trade}};
  }
}
