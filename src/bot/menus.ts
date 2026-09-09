import { Markup } from 'telegraf';
import { hasCapability, type AccessProfile } from '../product/capabilities.js';

function alphaWebUrl(): string | null {
  const value = String(process.env.ALPHAOS_WEB_URL ?? '').trim();
  if (!/^https:\/\//i.test(value)) return null;
  return value.replace(/\/+$/, '');
}

export function mainAlphaMenu(access: AccessProfile) {
  const rows: any[][] = [];
  const appUrl = alphaWebUrl();

  if (appUrl) {
    rows.push([Markup.button.url('✦ Open AlphaOS App', appUrl)]);
  }

  rows.push(
    [
      Markup.button.callback('⚡ Radar', 'OPPORTUNITY_CENTER'),
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
      Markup.button.callback('⚙ Controls', 'SETTINGS'),
      Markup.button.callback('✦ Pro', 'MEMBERSHIP_HOME'),
    ],
  );

  if (hasCapability(access, 'trading.admin')) {
    rows.push([Markup.button.callback('👑 Admin', 'ADMIN_TERMINAL_REFRESH')]);
  }

  return Markup.inlineKeyboard(rows);
}

export function intelligenceMenu(access: AccessProfile) {
  const rows: any[][] = [
    [Markup.button.callback('🔎 Research', 'INTEL_INVESTIGATIONS')],
  ];

  if (hasCapability(access, 'intelligence.smartMoney')) {
    rows.push([
      Markup.button.callback('🐋 Smart Money', 'INTEL_SMART_MONEY'),
      Markup.button.callback('👤 Developers', 'INTEL_CREATORS'),
    ]);
    rows.push([Markup.button.callback('📊 Track Record', 'INTEL_PERFORMANCE')]);
  } else {
    rows.push([Markup.button.callback('✦ Unlock Intelligence', 'MEMBERSHIP_PLANS')]);
  }

  if (hasCapability(access, 'trading.admin')) {
    rows.push([Markup.button.callback('𝕏 X Intelligence', 'X_INTEL_HOME')]);
  }

  rows.push([Markup.button.callback('⌂ Home', 'MAIN_MENU')]);
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
        Markup.button.callback('🛡 Risk', 'ADMIN_TRADE_SETTINGS'),
        Markup.button.callback('🧠 Learning', 'LEARNING_SUMMARY'),
      ],
      [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
    ]);
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback('⚡ Open Radar', 'OPPORTUNITY_CENTER')],
    [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
  ]);
}

export function backHome(parentLabel: string, parentCallback: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`‹ ${parentLabel}`, parentCallback),
      Markup.button.callback('⌂ Home', 'MAIN_MENU'),
    ],
  ]);
}

export function backToMainMenu() {
  return {
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('⌂ Home', 'MAIN_MENU')],
    ]).reply_markup,
  };
}
