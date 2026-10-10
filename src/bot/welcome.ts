import { Markup } from 'telegraf';
import { RESEARCH_DISCLOSURE } from '../ui/researchDisclosure.js';

export const alphaosWelcomeText = [
  '<b>Welcome to AlphaOS 🔎</b>',
  '<i>Crypto research, made easier.</i>', '',
  'Screen tokens and wallets, explore creator information, and receive launch and market alerts.', '',
  '<b>Get started</b>',
  '🔎 Send /scan &lt;address&gt; — Robinchain or ARC.',
  '👤 Use /scan wallet &lt;address&gt; for wallet research.',
  '⚙️ Alert Preferences — choose available feeds.',
  '🎯 Trader Tools — Readiness and one-hour monitors for supported Robinchain tokens.',
  '👥 Add to Group — enable contract screening.', '',
  'Open <b>How to Use</b> for alert meanings and group setup.',
  '<i>Data varies by chain. Missing data is not a passed check. Research only; safety and returns are not guaranteed.</i>',
  RESEARCH_DISCLOSURE,
].join('\n');

export const alphaosScanGuide = [
  '<b>🔎 Screen a token or wallet</b>', '',
  'Send <code>/scan &lt;contract address&gt;</code> or paste one address in private chat.',
  'For a wallet, send <code>/scan wallet &lt;wallet address&gt;</code>.', '',
  'Supported here: <b>Robinchain and ARC</b>. If an address exists on both chains, choose the chain shown by the bot.',
  'Available research may include price, MC or FDV, liquidity, volume, socials, creator balance and observed launch history.',
  'MC and FDV are different. Unavailable history does not mean the creator has never launched a token.', '',
  'Use Refresh for an updated snapshot. Creator links open wallet research.',
  '<i>Coverage is partial. Missing data is not a safety check.</i>',
  RESEARCH_DISCLOSURE,
].join('\n');

export const alphaosGroupGuide = [
  '<b>👥 Use AlphaOS in your group</b>', '',
  '1. Add AlphaOS using the button below.',
  '2. A group administrator sends <code>/scan_on</code>.',
  '3. Members send <code>/scan@YourBotUsername &lt;address&gt;</code>, replacing YourBotUsername with this bot’s username.',
  'For automatic screening of pasted addresses, make AlphaOS a group administrator so it can receive ordinary messages.',
  'Use <code>/scan_off</code> to disable automatic screening.', '',
  'Group members receive requested research in the group. Personal alert feeds and preferences stay in private chats; each user must open the bot and tap Start.',
  RESEARCH_DISCLOSURE,
].join('\n');

export const alphaosUsageGuide = [
  '<b>📖 AlphaOS · How to Use</b>', '',
  '<b>Screen</b> — /scan &lt;contract address&gt; for token research; /scan wallet &lt;address&gt; for wallet research. Robinchain and ARC are supported in this flow.', '',
  '<b>Choose alerts</b> — Alert Preferences opens available strategy controls. Availability depends on access and active feeds.', '',
  '<b>What the alerts mean</b>',
  '⚡ <b>Boost</b> — additional token promotion; promotion does not establish quality.',
  '💎 <b>DEX Paid</b> — a newly confirmed DexScreener payment; no market-cap or token-age limit. Applicable contract safety checks remain. Enable DEX Paid · Robinchain in Alert Preferences. Free receives a 30-second release delay; Pro receives priority delivery.',
  '🕶 <b>Social Mafia</b> — verified launchpad and exact contract confirmed on X, with recent buying and fresh creator balance or verified burn evidence. Telegram is optional. Market and ownership risks remain.',
  '🏆 <b>Runner milestones</b> — 2×, 5×, 10×, 50× and 100× sampled USD price moves from tracked alerts. Follows your source-feed preferences; limited checkpoint coverage, not trade profit.',
  '🔎 <b>Protocol Discovery</b> — PONS projects named Protocol/Protocols with X and Telegram links. Screened on the bounded launch watch, with no X contract-publication requirement. Social ownership is unverified.',
  '📊 <b>Trade Setup Watch</b> — verified PONS curves show a recovery or breakout with two spaced reserve/price increases, with fresh creator holding/transfer evidence. Older Robinchain pools can also qualify for Volume Surge Watch: completed-day pool volume ≥2× the preceding seven completed days’ daily average, with a positive price change on that signal day and all eight days of history. This is a research watch, not a buy recommendation. X contract publication is not required; social identity remains unverified.', '',
  '🟣 <b>ARC Opportunity</b> — qualifying liquidity and trading activity plus mandatory sellability evidence. Incomplete sellability blocks an alert; observed sells alone do not pass it.', '',
  '<b>Trader tools · Pro</b> — open Readiness on an indexed Robinchain token, then Monitor 1h. Watch / Setup forming describes market screening, not entry approval. Personal monitors check about every 2 minutes, expire after one hour and issue at most three warning events. Manage them in Home → My Monitors.', '',
  '🎯 <b>Pump.fun Momentum</b> — verified Pump.fun tokens on PumpSwap, rising price and 2× observed short-window volume. Creator holdings and sampled owner concentration are checked; this is research, not an entry signal.', '',
  '<b>Free / Pro</b> — open the plan guide on Home. Pro tools are available during testing; payments remain closed.', '',
  '<b>Groups</b> — an admin enables /scan_on. Open Add to Group for instructions.',
  '<b>Help</b> — reopen this guide anytime with /help or How to Use on Home.', '',
  '<i>Missing data is not a passed check. AlphaOS does not guarantee legitimacy, safety or profits.</i>',
  RESEARCH_DISCLOSURE,
].join('\n');

export function alphaosWelcomeKeyboard(username?: string) {
  const invite = /^[A-Za-z0-9_]{5,32}$/.test(username ?? '') ? `https://t.me/${username}?startgroup=true` : null;
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔎 Scan', 'WELCOME_SCAN'), Markup.button.callback('⚙️ Alert Preferences', 'STRATEGY_SETTINGS')],
    [Markup.button.callback('📖 How to Use', 'WELCOME_HELP'), Markup.button.callback('👥 Group Setup', 'WELCOME_GROUP')],
    ...(invite ? [[Markup.button.url('➕ Add to Group', invite)]] : []),
    [Markup.button.callback('✦ Free / Pro', 'FEATURE_GUIDE'), Markup.button.callback('⌂ Home', 'MAIN_MENU')],
  ]);
}
