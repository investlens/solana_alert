/** Opaque Telegram callback IDs (<=64 bytes); no signing, RPC or trade execution. */
import { randomBytes } from 'node:crypto';
import { validateManualEchoIntent, type ManualEchoIntent } from './manualTradeIntent.js';
export type StoredEchoCallback = { intent: ManualEchoIntent; expiresAtMs: number };
export interface EchoCallbackStore {
  /** Must atomically consume once, returning null for missing/expired/replayed tokens. */
  consumeOnce(token: string): Promise<StoredEchoCallback | null>;
  insertOnce(token: string, payload: StoredEchoCallback): Promise<boolean>;
}
export function newEchoCallbackToken(): string { return 'echo_' + randomBytes(24).toString('base64url'); }
export async function createEchoTradeCallback(
 store: EchoCallbackStore, intent: ManualEchoIntent, nowMs: number,
): Promise<{created:true; token:string}|{created:false;reason:string}> {
 const check=validateManualEchoIntent(intent);
 if (check.allowed === false) return {created:false,reason:check.reason};
 if (!Number.isSafeInteger(nowMs)) return {created:false,reason:'INVALID_CLOCK'};
 const token=newEchoCallbackToken();
 try {
  if (!await store.insertOnce(token,{intent,expiresAtMs:nowMs+60_000}))
   return {created:false,reason:'TOKEN_COLLISION'};
  return {created:true,token};
 } catch { return {created:false,reason:'CALLBACK_STORE_UNAVAILABLE'}; }
}
/** Telegram user ID must come from verified callback_query.from.id, never callback_data. */
export async function authorizeEchoTelegramCallback(
 store: EchoCallbackStore, token: string, verifiedTelegramUserId: string, nowMs: number,
): Promise<{allowed:true;intent:ManualEchoIntent}|{allowed:false;reason:string}> {
 if (!/^echo_[A-Za-z0-9_-]{32}$/.test(token) || !verifiedTelegramUserId || !Number.isSafeInteger(nowMs))
  return {allowed:false,reason:'INVALID_CALLBACK'};
 let saved:StoredEchoCallback|null;
 try { saved=await store.consumeOnce(token); }
 catch { return {allowed:false,reason:'CALLBACK_STORE_UNAVAILABLE'}; }
 if (!saved || !Number.isSafeInteger(saved.expiresAtMs) || nowMs>saved.expiresAtMs)
  return {allowed:false,reason:'EXPIRED_OR_REPLAYED'};
 if (saved.intent.telegramUserId!==verifiedTelegramUserId)
  return {allowed:false,reason:'UNAUTHORIZED_ADMIN'};
 const check=validateManualEchoIntent(saved.intent);
 return check.allowed === true ? {allowed:true,intent:saved.intent} : {allowed:false,reason:check.reason};
}
