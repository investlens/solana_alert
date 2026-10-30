/** Transport-level Telegram callback adapter. Does not place trades.
 * Only call after the Telegram bot library has verified the update origin.
 */
import { authorizeEchoTelegramCallback, type EchoCallbackStore } from './telegramTradeCallback.js';
import type { ManualEchoIntent } from './manualTradeIntent.js';
export type VerifiedEchoTelegramUpdate = {
 fromId: number;
 data: string;
 chatId: number;
 messageId: number;
};
export type EchoTradeQueue = {
 /** Durable queue admission; this is not a trade execution request. */
 enqueueForReview(intent: ManualEchoIntent, callbackId: string): Promise<boolean>;
};
export async function handleEchoTradeCallback(
 update: VerifiedEchoTelegramUpdate,
 adminTelegramId: string,
 store: EchoCallbackStore,
 queue: EchoTradeQueue,
 nowMs: number,
): Promise<{ accepted: boolean; reason: string }> {
 if (!Number.isSafeInteger(update.fromId) || String(update.fromId) !== adminTelegramId)
  return { accepted: false, reason: 'UNAUTHORIZED_ADMIN' };
 if (!Number.isSafeInteger(update.chatId) || !Number.isSafeInteger(update.messageId))
  return { accepted: false, reason: 'INVALID_TELEGRAM_CONTEXT' };
 const decision = await authorizeEchoTelegramCallback(store, update.data, String(update.fromId), nowMs);
 if (decision.allowed === false) return { accepted: false, reason: decision.reason };
 try {
  const admitted = await queue.enqueueForReview(decision.intent, update.data);
  return admitted ? { accepted: true, reason: 'QUEUED_FOR_REVIEW_ONLY' } :
   { accepted: false, reason: 'DUPLICATE_OR_REJECTED' };
 } catch { return { accepted: false, reason: 'QUEUE_UNAVAILABLE' }; }
}
