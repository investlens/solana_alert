/** Fully local model of Echo's two $10 positions and owner-only exits.
 * TEST FIXTURES ONLY. This is NOT a Jupiter/Pump swap simulation, signer,
 * or an on-chain trade; it never calls an RPC endpoint or imports wallet secrets.
 * Real execution must use an atomic Postgres reservation and chain-verified exits.
 */
import {screenEchoTenDollarPilot,type PilotOrder} from './tenDollarPilot.js';
import {screenEchoManualSell,type EchoManualSellRequest} from './manualSellAdmission.js';
import {manualSellReleasesBuySlot} from './sharedTradeExecution.js';

type Position={mint:string;principalUsd:10;tokenBalanceRaw:bigint;status:'OPEN'|'PENDING_EXIT'};
type TradeEvent={kind:'BUY_MODELLED'|'SELL_MODELLED'|'BUY_SKIPPED';mint:string;reason?:string;percent?:50|100};
export class EchoLocalTradeModel {
 private positions=new Map<string,Position>();
 private everBought=new Set<string>();
 private dailyBuys=0;
 private stopBuys=false;
 private events:TradeEvent[]=[];
 private serial=Promise.resolve();
 private queue<T>(work:()=>Promise<T>):Promise<T>{
  const result=this.serial.then(work);
  this.serial=result.then(()=>{},()=>{});
  return result;
 }
 get snapshot(){return {
  openPositions:this.positions.size,principalUsd:this.positions.size*10,
  dailyBuys:this.dailyBuys,stopBuys:this.stopBuys,
  events:this.events.map(x=>({...x}))
 };}
 setBuyKillSwitch(on:boolean){this.stopBuys=on;}
 async modelBuy(order:PilotOrder,tokenBalanceRaw:bigint){
  return this.queue(async()=>{
   const check=screenEchoTenDollarPilot({
    ...order,alreadyReservedOrPurchased:this.everBought.has(order.mint),
    openOrPendingPositions:this.positions.size,
    openOrPendingPrincipalUsd:this.positions.size*10,
    spentOrdersToday:this.dailyBuys,
    killSwitchEngaged:this.stopBuys||order.killSwitchEngaged
   });
   if(!check.allowed||tokenBalanceRaw<=0n){
    const reason='reason' in check?check.reason:'INVALID_FIXTURE_BALANCE';
    this.events.push({kind:'BUY_SKIPPED',mint:order.mint,reason});
    return {modelled:false as const,reason};
   }
   this.everBought.add(order.mint);
   this.positions.set(order.mint,{mint:order.mint,principalUsd:10,tokenBalanceRaw,status:'OPEN'});
   this.dailyBuys++;
   this.events.push({kind:'BUY_MODELLED',mint:order.mint});
   return {modelled:true as const,lamports:check.amountLamports};
  });
 }
 async modelManualSell(sell:EchoManualSellRequest,proof:{
  chainConfirmed:boolean;balanceZeroVerified:boolean;proceedsVerified:boolean;sellSignaturePersisted:boolean
 }){
  return this.queue(async()=>{
   const position=this.positions.get(sell.mint);
   if(!position||position.status!=='OPEN')
    return {modelled:false as const,reason:'NO_OPEN_POSITION'};
   const gate=screenEchoManualSell(sell);
   if('reason' in gate)return {modelled:false as const,reason:gate.reason};
   if(BigInt(sell.verifiedTokenBalanceRaw)!==position.tokenBalanceRaw)
    return {modelled:false as const,reason:'STALE_TOKEN_BALANCE'};
   // There is no on-chain verification here. These flags are explicit local
   // fixture assertions, never evidence acceptable to a live signer.
   if(!proof.chainConfirmed||!proof.proceedsVerified||!proof.sellSignaturePersisted)
    return {modelled:false as const,reason:'MODEL_SETTLEMENT_NOT_VERIFIED'};
   const amount=(position.tokenBalanceRaw*BigInt(gate.percent))/100n;
   if(amount<=0n)return {modelled:false as const,reason:'DUST_SELL'};
   const balance=position.tokenBalanceRaw-amount;
   if(gate.percent===100){
    if(balance!==0n||!manualSellReleasesBuySlot({
      soldPercent:100,transactionConfirmed:proof.chainConfirmed,
      balanceZeroVerified:proof.balanceZeroVerified,
      proceedsVerified:proof.proceedsVerified,
      sellSignaturePersisted:proof.sellSignaturePersisted
    }))return {modelled:false as const,reason:'FULL_EXIT_PROOF_REQUIRED'};
    this.positions.delete(sell.mint);
   }else{
    position.tokenBalanceRaw=balance;
   }
   this.events.push({kind:'SELL_MODELLED',mint:sell.mint,percent:gate.percent});
   return {modelled:true as const,remainingBalanceRaw:balance.toString(),
    slotReleased:gate.percent===100};
  });
 }
}
export const ECHO_LOCAL_MODEL_NETWORK_ENABLED=false as const;
