/** Telegram callback preparation only: no bot registration, signing or execution. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateManualEchoIntent, type ManualEchoIntent } from './manualTradeIntent.js';

export type EchoCallbackPayload = {
  intent: ManualEchoIntent;
  expiresAtMs: number;
  nonce: string;
};
export type EchoCallbackDecision =
  | { allowed: true; intent: ManualEchoIntent; nonce: string }
  | { allowed: false; reason: string };

/** Caller must provide the Telegram-verified from.id, not an ID from callback_data. */
export function authorizeEchoTelegramCallback(
  token: string, secret: string, telegramVerifiedUserId: string,
  nowMs: number, consumeNonce: (nonce: string, expiresAtMs: number) => Promise<boolean>,
): Promise<EchoCallbackDecision> {
  return authorize(token, secret, telegramVerifiedUserId, nowMs, consumeNonce);
}
async function authorize(token: string, secret: string, userId: string, nowMs: number,
 consumeNonce: (nonce: string, expiresAtMs: number) => Promise<boolean>): Promise<EchoCallbackDecision> {
  if (!secret || secret.length < 32 || !userId || !Number.isSafeInteger(nowMs))
    return { allowed: false, reason: 'INVALID_AUTH_CONFIG' };
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0].length > 4096 || !/^[a-f0-9]{64}$/.test(parts[1]))
    return { allowed: false, reason: 'INVALID_CALLBACK_TOKEN' };
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'hex');
  if (!timingSafeEqual(expected, supplied)) return { allowed: false, reason: 'INVALID_SIGNATURE' };
  let payload: EchoCallbackPayload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as EchoCallbackPayload; }
  catch { return { allowed: false, reason: 'INVALID_CALLBACK_PAYLOAD' }; }
  if (!payload || !payload.intent || !Number.isSafeInteger(payload.expiresAtMs) ||
      payload.expiresAtMs < nowMs || payload.expiresAtMs > nowMs + 60_000 ||
      typeof payload.nonce !== 'string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(payload.nonce))
    return { allowed: false, reason: 'EXPIRED_OR_INVALID_CALLBACK' };
  if (payload.intent.telegramUserId !== userId)
    return { allowed: false, reason: 'UNAUTHORIZED_ADMIN' };
  const decision = validateManualEchoIntent(payload.intent);
  if (!decision.allowed) return { allowed: false, reason: decision.reason };
  try {
    if (!await consumeNonce(payload.nonce, payload.expiresAtMs))
      return { allowed: false, reason: 'CALLBACK_REPLAY' };
  } catch { return { allowed: false, reason: 'NONCE_STORE_UNAVAILABLE' }; }
  return { allowed: true, intent: payload.intent, nonce: payload.nonce };
}
/** Tokens must be created server-side, never from client-controlled callback fields. */
export function signEchoCallbackPayload(payload: EchoCallbackPayload, secret: string): string {
  if (secret.length < 32) throw Error('INVALID_AUTH_CONFIG');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + createHmac('sha256', secret).update(body).digest('hex');
}
