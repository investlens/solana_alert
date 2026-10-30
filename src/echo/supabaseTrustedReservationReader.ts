/** Read-only server-side Supabase adapter for Echo buy reservations.
 * Service-role keys must stay outside Telegram bot and browsers. No mutations.
 * Production schema must include position_closed_at before this can operate.
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import type {EchoTrustedReservationReader,EchoTrustedReservation} from './trustedReservationPreview.js';
export function createEchoTrustedSupabaseReader(client:SupabaseClient):EchoTrustedReservationReader{
 return {
  async getByWalletAndMint(wallet,mint):Promise<EchoTrustedReservation|null>{
   const {data,error}=await client.from('echo_live_buy_intents')
    .select('execution_wallet,mint,state,amount_lamports,position_closed_at,transaction_signature')
    .eq('execution_wallet',wallet).eq('mint',mint).maybeSingle();
   if(error)throw Error('ECHO_TRUSTED_LEDGER_UNAVAILABLE');
   if(!data)return null;
   if(typeof data.execution_wallet!=='string'||typeof data.mint!=='string'||
      typeof data.state!=='string'||!Number.isSafeInteger(Number(data.amount_lamports))||
      data.position_closed_at!==null&&typeof data.position_closed_at!=='string')
    throw Error('ECHO_TRUSTED_LEDGER_INVALID');
   return {executionWallet:data.execution_wallet,mint:data.mint,state:data.state,
    amountLamports:Number(data.amount_lamports),positionClosedAt:data.position_closed_at,
    transactionSignature:typeof data.transaction_signature==='string'?data.transaction_signature:null};
  }
 };
}
