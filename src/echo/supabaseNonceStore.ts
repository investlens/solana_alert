/** Durable one-use coordinator nonce adapter for isolated signer.
 * This must only execute inside the trusted signer service, using a dedicated
 * restricted DB identity. No seeds, transaction signatures or Telegram tokens.
 * Requires the review-only echo-signer-nonce-replay-journal.sql migration.
 */
import type {SupabaseClient} from '@supabase/supabase-js';
import type {EchoNonceStore} from './authenticatedSignerRequest.js';
export function createEchoSupabaseNonceStore(client:SupabaseClient):EchoNonceStore {
 return {
  async consumeOnce(nonceHex,expiresAtMs){
   if(!/^[a-f0-9]{64}$/.test(nonceHex)||
      !Number.isSafeInteger(expiresAtMs)||
      expiresAtMs<Date.now()||expiresAtMs>Date.now()+30_000)
    return false;
   try {
    const {data,error}=await client.rpc('echo_signer_consume_nonce',{
      p_nonce_hex:nonceHex,
      p_expires_at:new Date(expiresAtMs).toISOString()
    });
    if(error||typeof data!=='boolean')return false;
    return data===true;
   }catch{return false;}
  }
 };
}
