import type { Telegraf } from 'telegraf';
import { extractScanContract, getRobinhoodContractReport, renderContractScreen } from './contractScreening.js';
import { buildAlphaosAlertCard } from '../ui/alphaosAlertCard.js';
import { getReportedPonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';
import { chooseResearchPair, fetchResearchPairs, loadCreatorResearch, readResearchAccount, renderCreatorResearch,
  researchCandidates, researchChains, type ResearchChain } from '../services/addressResearch.js';

type Screen = { text: string; image: Buffer; chain: ResearchChain; wallet: boolean; chart?: string };
type Choice = { choices: ResearchChain[]; reason: string };
const cache = new Map<string, { expires: number; value: Screen | Choice }>();
const inflight = new Map<string, Promise<Screen | Choice>>();
const groups = new Map<string, number>(); const cooldowns = new Map<string, number>();
let budgetAt = 0; let budget = 0;
const code = (chain: ResearchChain) => chain === 'robinhood' ? 'RH' : 'ARC';
const chainFromCode = (value: string): ResearchChain => value === 'RH' ? 'robinhood' : 'arc';
export function parseResearchChain(text: string): ResearchChain | null {
  if (/^robin(?:hood|chain)\s/i.test(text)) return 'robinhood';
  if (/^arc\s/i.test(text)) return 'arc';
  return null;
}
export function creatorDeepLink(text: string, username?: string): string {
  if (!username || !/^[A-Za-z0-9_]+$/.test(username)) return text;
  return text.replace(/href="https:\/\/robinhoodchain\.blockscout\.com\/address\/(0x[a-fA-F0-9]{40})"/g,
    (_match, address: string) => `href="https://t.me/${username}?start=ci_RH_${address.toLowerCase()}"`);
}
export async function getAddressScreen(address: string, chain?: ResearchChain | null, fresh = false, wallet = false): Promise<Screen | Choice> {
  const key = `${chain ?? 'auto'}:${address}:${wallet}`; const cached = cache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  if (inflight.has(key)) return inflight.get(key)!;
  if (inflight.size >= 3) throw new Error('Research capacity reached');
  if (Date.now() - budgetAt >= 60_000) { budgetAt = Date.now(); budget = 0; }
  if (budget >= 10) throw new Error('Research budget reached'); budget++;
  const work = (async (): Promise<Screen | Choice> => {
    const pairs = wallet ? [] : await fetchResearchPairs(address).catch(() => []);
    let selected = chain;
    if (!selected) {
      const matches = (['robinhood', 'arc'] as const).filter(c => !!chooseResearchPair(pairs, address, c));
      if (matches.length === 1) selected = matches[0];
      else if (matches.length > 1) return { choices: [...matches], reason: 'This address has indexed tokens on both chains. Choose the chain.' };
      else {
        const [rh, arc, pons] = await Promise.all([readResearchAccount(address, 'robinhood', fresh), readResearchAccount(address, 'arc', fresh),
          getReportedPonsPublicContext(address).catch(() => null)]);
        const candidates = researchCandidates(pairs, address, { robinhood: rh, arc });
        if (pons && !candidates.includes('robinhood')) candidates.push('robinhood');
        if (candidates.length === 1 && rh.kind !== 'unknown' && arc.kind !== 'unknown') selected = candidates[0];
        else return { choices: ['robinhood', 'arc'], reason: candidates.length > 1 ? 'Activity found on both chains. Choose the chain.' :
          'The chain cannot be identified reliably from this address. Choose Robinchain or ARC.' };
      }
    }
    const config = researchChains[selected]; const pair = chooseResearchPair(pairs, address, selected);
    const pons = !wallet && selected === 'robinhood' ? await getReportedPonsPublicContext(address).catch(() => null) : null;
    const account = pair || pons ? null : await readResearchAccount(address, selected, fresh);
    if (wallet || account?.kind === 'wallet') {
      const facts = account ?? await readResearchAccount(address, selected, fresh);
      const history = await loadCreatorResearch(address, selected).catch(() => ({ launches: [], available: false, capped: false }));
      return { chain: selected, wallet: true, text: renderCreatorResearch(address, selected, facts, history),
        image: await buildAlphaosAlertCard({ title: 'Creator research', symbol: null, name: `${address.slice(0, 6)}…${address.slice(-4)}`, category: 'CREATOR INTEL',
          chainLabel: config.label.toUpperCase(), badge: 'WALLET RESEARCH', footer: 'Recorded launch history · Partial coverage · Research only' }) };
    }
    if (!pair && !pons && account?.kind === 'unknown') return { choices: [selected], reason: 'Live lookup is unavailable. Retry the selected chain shortly.' };
    if (selected === 'robinhood') return { ...await getRobinhoodContractReport(address, fresh), chain: selected, wallet: false };
    const text = renderContractScreen(address, pair, null, null, config.label);
    const chart = pair?.pairAddress && /^0x[a-fA-F0-9]{40}$/.test(pair.pairAddress) ? `https://dexscreener.com/arc/${pair.pairAddress}` : undefined;
    return { chain: selected, wallet: false, text, chart, image: await buildAlphaosAlertCard({ title: pair?.baseToken?.symbol ? undefined : 'Contract research', symbol: pair?.baseToken?.symbol,
      name: pair?.baseToken?.name, category: 'CONTRACT SCREEN', chainLabel: 'ARC', badge: 'MARKET SNAPSHOT', footer: 'Requested contract research · Safety not assessed' }) };
  })();
  inflight.set(key, work);
  try {
    const value = await work;
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 30_000 }); return value;
  } finally { inflight.delete(key); }
}
export function registerAddressScreening(bot: Telegraf<any>, lookup = getAddressScreen): void {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of cache) if (value.expires <= now) cache.delete(key);
    for (const [key, expiry] of groups) if (expiry <= now) groups.delete(key);
    for (const [key, expiry] of cooldowns) if (expiry <= now) cooldowns.delete(key);
  }, 30_000); timer.unref();
  async function screen(ctx: any, address: string, chain?: ResearchChain | null, refresh = false, wallet = false) {
    const chat = String(ctx.chat.id);
    if ((cooldowns.get(chat) ?? 0) > Date.now()) {
      if (ctx.callbackQuery) await ctx.answerCbQuery('Please wait 15 seconds.').catch(() => {});
      else await ctx.reply('Please wait 15 seconds between scans.'); return;
    }
    if (cooldowns.size >= 500) cooldowns.delete(cooldowns.keys().next().value!);
    cooldowns.set(chat, Date.now() + 15_000);
    if (ctx.callbackQuery) await ctx.answerCbQuery('Checking…').catch(() => {});
    try {
      const result = await lookup(address, chain, refresh, wallet);
      if ('choices' in result) {
        cooldowns.delete(chat); // A chain-choice click must not be blocked by its own scan.
        await ctx.reply(result.reason, { reply_markup: { inline_keyboard: [result.choices.map(c => ({ text: researchChains[c].label, callback_data: `${wallet ? 'WS' : 'AS'}_${code(c)}_${address}` }))] } }); return;
      }
      const config = researchChains[result.chain]; const tag = code(result.chain);
      const caption = creatorDeepLink(result.text, ctx.botInfo?.username ?? bot.botInfo?.username);
      const explorer = { text: '🔎 Explorer', url: `${config.explorer}/${result.wallet ? 'address' : 'token'}/${address}` };
      const keyboard = { inline_keyboard: result.wallet || result.chain === 'arc' ? [
        [{ text: '↻ Refresh', callback_data: `${result.wallet ? 'CW' : 'AR'}_${tag}_${address}` }, explorer],
        ...(result.chart ? [[{ text: '📊 Chart', url: result.chart }]] : []),
      ] : [
        [{ text: '↻ Refresh', callback_data: `AR_${tag}_${address}` }, { text: '🧠 Full Intel', callback_data: `FI_RH_${address}` }],
        [explorer, ...(result.chart ? [{ text: '📊 Chart', url: result.chart }] : [])],
      ] };
      if (refresh) await ctx.editMessageMedia({ type: 'photo', media: { source: result.image }, caption, parse_mode: 'HTML' }, { reply_markup: keyboard });
      else await ctx.replyWithPhoto({ source: result.image }, { caption, parse_mode: 'HTML', reply_markup: keyboard,
        reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
    } catch (error) {
      if (refresh) { if (!/message is not modified/i.test(String(error))) await ctx.answerCbQuery('Refresh unavailable; try again shortly.', { show_alert: true }).catch(() => {}); }
      else await ctx.reply('Research is temporarily unavailable. No safety conclusion was made.');
    }
  }
  // Register before the standard /start handler so creator deep links resolve here.
  bot.hears(/^\/start(?:@\S+)?\s+ci_(RH|ARC)_(0x[a-fA-F0-9]{40})$/, async ctx => screen(ctx, ctx.match[2].toLowerCase(), chainFromCode(ctx.match[1]), false, true));
  bot.command('scan', async ctx => {
    const text = ctx.message.text.replace(/^\/scan(?:@\S+)?\s*/i, ''); const address = extractScanContract(text);
    if (!address) { await ctx.reply('Paste one Robinchain or ARC address, or use /scan <address>. Other chains are not supported in this scan yet.'); return; }
    if (!/^(?:robin(?:hood|chain)\s+|arc\s+|wallet\s+)?0x/i.test(text.trim())) { await ctx.reply('Supported chains: Robinchain and ARC. Use /scan <address>.'); return; }
    await screen(ctx, address, parseResearchChain(text), false, /^wallet\s/i.test(text));
  });
  bot.action(/^(AS|WS|AR|CW)_(RH|ARC)_(0x[a-fA-F0-9]{40})$/, async ctx => screen(ctx, ctx.match[3].toLowerCase(), chainFromCode(ctx.match[2]), ['AR', 'CW'].includes(ctx.match[1]), ['CW', 'WS'].includes(ctx.match[1])));
  bot.action(/^SCAN_RH_(0x[a-fA-F0-9]{40})$/, async ctx => screen(ctx, ctx.match[1].toLowerCase(), 'robinhood', true));
  async function admin(ctx: any) {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return false;
    return ['creator', 'administrator'].includes((await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)).status);
  }
  bot.command('scan_on', async ctx => {
    if (!await admin(ctx)) { await ctx.reply('A group administrator must enable scanning.'); return; }
    if (groups.size >= 100 && !groups.has(String(ctx.chat.id))) { await ctx.reply('Group scanning capacity reached.'); return; }
    groups.set(String(ctx.chat.id), Date.now() + 24 * 60 * 60_000);
    await ctx.reply('Address research enabled for 24 hours. Paste a Robinchain or ARC contract or wallet. /scan_off disables it.');
  });
  bot.command('scan_off', async ctx => { if (await admin(ctx)) { groups.delete(String(ctx.chat.id)); await ctx.reply('Automatic address research disabled.'); } });
  bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next();
    if (ctx.chat.type !== 'private' && (groups.get(String(ctx.chat.id)) ?? 0) <= Date.now()) return next();
    const text = ctx.message.text.trim(); const address = extractScanContract(text);
    if (!address || text.toLowerCase() !== address) return next();
    await screen(ctx, address);
  });
  console.log('[AddressScreen] READY chains=robinhood,arc walletResearch=true autoDetect=true');
}
