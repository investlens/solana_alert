/** Server-only Supabase adapter. No signing, broadcast or credentials in this module. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EchoReservationStore } from './paperReservation.js';
/** The DB primary key (execution_wallet,mint) is the atomic duplicate barrier. */
export function createEchoSupabaseReservationStore(client: SupabaseClient): EchoReservationStore {
  return {
    async insertOnce(row) {
      const { error } = await client.from('echo_live_buy_intents').insert({
        execution_wallet: row.executionWallet,
        mint: row.mint,
        caller_wallet: row.callerWallet,
        source_signature: row.sourceSignature,
        amount_lamports: row.amountLamports,
        state: 'reserved',
      });
      if (!error) return true;
      // PostgreSQL unique_violation. Never treat outages, permission failures or
      // validation errors as duplicates: caller must fail closed.
      if (error.code === '23505') return false;
      throw new Error('ECHO_RESERVATION_STORAGE_ERROR');
    },
  };
}
