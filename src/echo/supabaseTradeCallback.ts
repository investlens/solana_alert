/** Trusted-server Supabase callback store. Requires echo-trade-callbacks.sql. */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EchoCallbackStore, StoredEchoCallback } from './telegramTradeCallback.js';
function hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function createEchoSupabaseCallbackStore(client: SupabaseClient): EchoCallbackStore {
 return {
  async insertOnce(token: string, payload: StoredEchoCallback): Promise<boolean> {
   const { error } = await client.from('echo_trade_callbacks').insert({
    token_hash: hash(token), intent: payload.intent,
    expires_at: new Date(payload.expiresAtMs).toISOString(),
   });
   if (!error) return true;
   if (error.code === '23505') return false;
   throw Error('ECHO_CALLBACK_STORAGE_UNAVAILABLE');
  },
  async consumeOnce(token: string): Promise<StoredEchoCallback|null> {
   const { data, error } = await client.rpc('echo_consume_trade_callback', { p_token_hash: hash(token) });
   if (error) throw Error('ECHO_CALLBACK_STORAGE_UNAVAILABLE');
   if (!Array.isArray(data) || data.length === 0) return null;
   if (data.length !== 1 || !data[0]?.intent || !data[0]?.expires_at)
    throw Error('ECHO_CALLBACK_INVALID_ROW');
   const expiresAtMs = Date.parse(data[0].expires_at);
   if (!Number.isFinite(expiresAtMs)) throw Error('ECHO_CALLBACK_INVALID_EXPIRY');
   return { intent: data[0].intent, expiresAtMs };
  },
 };
}
