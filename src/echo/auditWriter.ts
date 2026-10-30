/**
 * Optional, non-authoritative AlphaOS Echo delivery audit.
 * The durable Railway volume controls Telegram dedup/retry, never Supabase.
 * No connection unless dedicated Echo audit credentials are explicitly set.
 */
export type EchoAuditDelivery = {
  signature: string; callerWallet: string; mint: string; caller: string;
  tradeAt: number; deliveredAt: number; telegramMessageId: number;
  quoteAmount: number | null; quoteSymbol: string; quoteBasis?: string;
  tokenAmount: number;
};
const solanaAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signatureFormat = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export function echoAuditRow(record: EchoAuditDelivery) {
  if (!signatureFormat.test(record.signature) || !solanaAddress.test(record.callerWallet) ||
      !solanaAddress.test(record.mint) ||
      !Number.isFinite(record.tradeAt) || record.tradeAt <= 0 ||
      !Number.isFinite(record.deliveredAt) || record.deliveredAt < record.tradeAt ||
      !Number.isSafeInteger(record.telegramMessageId) || record.telegramMessageId < 1 ||
      !Number.isFinite(record.tokenAmount) || record.tokenAmount <= 0 ||
      record.quoteAmount !== null && (!Number.isFinite(record.quoteAmount) || record.quoteAmount <= 0) ||
      record.caller.length > 80 || record.quoteSymbol.length > 20) return null;
  return {
    signature:record.signature,caller_wallet:record.callerWallet,mint:record.mint,side:'BUY',
    caller_label:record.caller,trade_at:new Date(record.tradeAt*1000).toISOString(),
    accepted_at:new Date(record.deliveredAt*1000).toISOString(),
    telegram_message_id:record.telegramMessageId,quote_amount:record.quoteAmount,
    quote_symbol:record.quoteSymbol,quote_basis:record.quoteBasis ?? null,
    token_amount:record.tokenAmount
  };
}
export function createEchoAuditWriter(env: NodeJS.ProcessEnv, post: typeof fetch = fetch) {
  const url = env.ECHO_AUDIT_SUPABASE_URL;
  const key = env.ECHO_AUDIT_SUPABASE_SERVICE_KEY;
  const enabled = env.ECHO_AUDIT_SUPABASE_ENABLED === 'true';
  if (!enabled) return {enabled:false,write:async (_record:EchoAuditDelivery)=>false};
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || key.length < 30)
    throw new Error('Echo audit enabled without verified Supabase credentials');
  return {enabled:true,write:async (record:EchoAuditDelivery) => {
    const row = echoAuditRow(record);
    if (!row) return false;
    try {
      const res=await post(url.replace(/\/$/,'')+'/rest/v1/echo_caller_alert_audit?on_conflict=signature,caller_wallet,mint,side',{
        method:'POST',headers:{'content-type':'application/json',apikey:key,authorization:'Bearer '+key,
          prefer:'resolution=ignore-duplicates,return=minimal'},
        body:JSON.stringify(row),signal:AbortSignal.timeout(3500)
      });
      return res.ok;
    } catch {return false;}
  }};
}
