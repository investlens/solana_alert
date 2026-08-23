import { Markup } from 'telegraf';

export function mainAlphaMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Opportunities', 'OPPORTUNITY_CENTER')],
    [Markup.button.callback('🐋 Wallets', 'WALLET_TRACKING')],
    [Markup.button.callback('🧠 AI Research', 'ALPHA_FEED')],
    [Markup.button.callback('📈 Trade Terminal', 'TRADE_MENU')],
    [
      Markup.button.callback('⭐ Premium', 'PREMIUM'),
      Markup.button.callback('🎯 Strategies', 'STRATEGY_SETTINGS'),
    ],
  ]);
}

export function alphaFeedMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🧠 Live Investigations', 'DEX_PAID')],
    [
      Markup.button.callback('🐋 Smart Money', 'WHALE_RADAR'),
      Markup.button.callback('👤 Creator Intel', 'CREATOR_INTEL'),
    ],
    [Markup.button.callback('📈 Performance Archive', 'HISTORY')],
    [Markup.button.callback('⬅️ Main Menu', 'MAIN_MENU')],
  ]);
}

export function tradeTerminalMenu(isAdmin: boolean) {
  return Markup.inlineKeyboard(
    isAdmin
      ? [
          [Markup.button.callback('📊 Auto Trade Status', 'AUTO_TRADE_STATUS')],
          [Markup.button.callback('🧠 Learning Summary', 'LEARNING_SUMMARY')],
          [
            Markup.button.callback('⏸ Pause', 'PAUSE_AUTO_TRADE'),
            Markup.button.callback('▶️ Resume', 'RESUME_AUTO_TRADE'),
          ],
          [Markup.button.callback('📈 Positions', 'POSITIONS')],
          [Markup.button.callback('⬅️ Main Menu', 'MAIN_MENU')],
        ]
      : [[Markup.button.callback('⬅️ Main Menu', 'MAIN_MENU')]]
  );
}

export function backToMainMenu() {
  return {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ Main Menu', 'MAIN_MENU')],
    ]).reply_markup,
  };
}