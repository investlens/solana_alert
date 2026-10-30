/** Atomic reservation boundary for the $10 Echo pilot.
 * The database adapter MUST lock and check slots + token uniqueness within
 * one transaction; never implement this with separate read/count/insert calls.
 * This module does not sign or broadcast transactions.
 */
import { screenEchoTenDollarPilot, type PilotOrder } from './tenDollarPilot.js';
export type EchoPositionLease = {
 executionWallet:string; mint:string; callerWallet:string; signature:string;
 principalUsd:10; amountLamports:number;
};
export type AtomicReservationResult =
 | {reserved:true; key:string}
 | {reserved:false;reason:'DUPLICATE_TOKEN'|'TWO_SLOTS_FULL'|'DAILY_LIMIT'|'DATABASE_UNAVAILABLE'};
export interface EchoAtomicPositionStore {
 reserveIfCapacity(lease:EchoPositionLease):Promise<AtomicReservationResult>;
}
export async function reserveEchoTenDollarPilot(
 order:PilotOrder, executionWallet:string, signature:string, store:EchoAtomicPositionStore
):Promise<AtomicReservationResult|{reserved:false;reason:string}> {
 const check=screenEchoTenDollarPilot(order);
 if('reason' in check)return {reserved:false,reason:check.reason};
 if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(executionWallet)||
   !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
   return {reserved:false,reason:'INVALID_TRANSACTION_IDENTITY'};
 try{
  return await store.reserveIfCapacity({executionWallet,mint:order.mint,
   callerWallet:order.callerWallet,signature,
   amountLamports:check.amountLamports,principalUsd:10});
 }catch{
  return {reserved:false,reason:'DATABASE_UNAVAILABLE'};
 }
}
export const ECHO_ATOMIC_RESERVATION_BROADCAST_ALLOWED=false as const;
