import { Markup } from 'telegraf';

export function mainAlphaMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚀 Alpha Feed', 'ALPHA_FEED'),
      Markup.button.callback('💎 DEX Paid', 'DEX_PAID'),
    ],
    [
      Markup.button.callback('🐋 Whale Radar', 'WHALE_RADAR'),
      Markup.button.callback('🧠 Creator Intel', 'CREATOR_INTEL'),
    ],
    [
      Markup.button.callback('⚡ Buy / Sell', 'TRADE_MENU'),
      Markup.button.callback('📈 Positions', 'POSITIONS'),
    ],
    [
      Markup.button.callback('🎯 Sniper', 'SNIPER'),
      Markup.button.callback('🛡 Risk Controls', 'RISK_CONTROLS'),
    ],
    [
      Markup.button.callback('🏆 Alpha Points', 'ALPHA_POINTS'),
      Markup.button.callback('👑 Premium', 'PREMIUM'),
    ],
    [
      Markup.button.callback('⚙ Settings', 'SETTINGS'),
      Markup.button.callback('💰 Wallet', 'WALLET'),
    ],
  ]);
}

export function backToMainMenu() {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Main Menu', 'MAIN_MENU')]]);
}