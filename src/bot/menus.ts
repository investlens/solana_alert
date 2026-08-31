import { Markup } from 'telegraf';
import { hasCapability, type AccessProfile } from '../product/capabilities.js';

export function mainAlphaMenu(access: AccessProfile) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚡ Opportunities', 'OPPORTUNITY_CENTER'),
      Markup.button.callback('🧠 Intelligence', 'INTELLIGENCE_CENTER'),
    ],
    [
      Markup.button.callback(
        hasCapability(access, 'wallets.track') ? '🐋 Wallets' : '🔒 Wallets',
        'WALLET_TRACKING',
      ),
      Markup.button.callback('📈 Trading', 'TRADE_MENU'),
    ],
    [
      Markup.button.callback('⚙️ Controls', 'SETTINGS'),
      Markup.button.callback('⭐ Membership', 'MEMBERSHIP_HOME'),
    ],
    ...(hasCapability(access, 'trading.admin')
      ? [[Markup.button.callback('👑 Admin Trading', 'ADMIN_TERMINAL_REFRESH')]]
      : []),
  ]);
}

export function intelligenceMenu(access: AccessProfile) {
  const rows: any[][] = [
    [Markup.button.callback('🔎 Investigations', 'INTEL_INVESTIGATIONS')],
  ];

  if (hasCapability(access, 'intelligence.smartMoney')) {
    rows.push([
      Markup.button.callback('🐋 Smart Money', 'INTEL_SMART_MONEY'),
      Markup.button.callback('👤 Creators', 'INTEL_CREATORS'),
    ]);
    rows.push([Markup.button.callback('📊 Performance', 'INTEL_PERFORMANCE')]);
  } else {
    rows.push([Markup.button.callback('⭐ Unlock Full Intelligence', 'MEMBERSHIP_PLANS')]);
  }

  if (hasCapability(access, 'trading.admin')) {
    rows.push([Markup.button.callback('🐦 X Intelligence', 'X_INTEL_HOME')]);
  }

  rows.push([Markup.button.callback('🏠 Home', 'MAIN_MENU')]);
  return Markup.inlineKeyboard(rows);
}

export function tradingMenu(access: AccessProfile) {
  if (hasCapability(access, 'trading.admin')) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('📈 Positions', 'POSITIONS'),
        Markup.button.callback('🤖 Automation', 'AUTO_TRADE_STATUS'),
      ],
      [
        Markup.button.callback('🛡 Risk Controls', 'ADMIN_TRADE_SETTINGS'),
        Markup.button.callback('🧠 Learning', 'LEARNING_SUMMARY'),
      ],
      [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Browse Opportunities', 'OPPORTUNITY_CENTER')],
    [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
  ]);
}

export function backHome(parentLabel: string, parentCallback: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`⬅️ ${parentLabel}`, parentCallback),
      Markup.button.callback('🏠 Home', 'MAIN_MENU'),
    ],
  ]);
}

export function backToMainMenu() {
  return {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
    ]).reply_markup,
  };
}
