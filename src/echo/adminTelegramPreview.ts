import { ECHO_ADMIN_PILOT } from './adminPilotConfig.js';

/**
 * Telegram AutoTrader preview. Pure renderer, not connected to getUpdates,
 * webhook, wallet, signing, order submission, or any production bot.
 */
export type AdminTelegramMessage = {
  from?: { id?: number; is_bot?: boolean };
  chat?: { id?: number; type?: string };
  text?: string;
};
export function renderEchoAdminPreview(
  message: AdminTelegramMessage,
  ownerChatId: string,
  botUsername?: string,
): string | null {
  // Require exact Telegram sender AND private chat identity; fail closed.
  if (!/^[1-9]\d*$/.test(ownerChatId)) return null;
  if (!message.from || message.from.is_bot || !Number.isSafeInteger(message.from.id) ||
      !message.chat || message.chat.type !== 'private' || !Number.isSafeInteger(message.chat.id) ||
      String(message.from.id) !== ownerChatId || String(message.chat.id) !== ownerChatId) return null;
  const text = message.text?.trim() ?? '';
  const match = /^\/autotrader(?:@([A-Za-z0-9_]{5,32}))?(?:\s.*)?$/i.exec(text);
  if (!match || (match[1] && (!botUsername || match[1].toLowerCase() !== botUsername.toLowerCase()))) return null;
  return [
    '⚡ ALPHAOS ECHO · AUTOTRADER · PREVIEW ONLY',
    '🔒 LIVE EXECUTION: OFF',
    '👤 Admin only · No wallet connected',
    '📡 Callers: Slingoor + Chairman',
    '💰 Maximum BUY: ' + ECHO_ADMIN_PILOT.solPerBuy.toFixed(2) + ' SOL',
    '📉 Maximum slippage: ' + (ECHO_ADMIN_PILOT.maxSlippageBps / 100).toFixed(0) + '%',
    '📊 Maximum open positions: ' + ECHO_ADMIN_PILOT.maxOpenPositions,
    '🛑 Daily loss breaker: ' + ECHO_ADMIN_PILOT.dailyLossCircuitBreakerSol.toFixed(2) + ' SOL',
    '🔁 Duplicate token buys: BLOCKED by policy (durable ledger pending)',
    '✋ Automatic SELL: OFF · Manual SELL implementation pending',
    '⚠️ No deposit address yet. Do not send SOL.',
  ].join('\n');
}
