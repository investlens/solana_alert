import { readResearchTokenSupply, formatResearchSupply, type ResearchTokenSupply } from '../services/researchTokenSupply.js';
import { extractAutomaticSocials } from '../ui/alphaNotificationActions.js';
import type { Telegraf } from 'telegraf';
import { fetchRobinhoodPairs, chooseBestRobinhoodPair, verifiedRobinhoodChartUrl, type DexScreenerPair } from '../chains/robinhood/market.js';
import { buildAlphaosAlertCard } from '../ui/alphaosAlertCard.js';
import { getSharedJson } from '../services/sharedJsonCache.js';
import { getPonsFactoryDeployments } from '../chains/robinhood/ponsContracts.js';
import { getVerifiedPonsPublicContext, getReportedPonsPublicContext, getScreenCreatorBalance, type PonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';

const groups = new Map<string, number>();
const cooldowns = new Map<string, number>();
const reports = new Map<string, { expires: number; text: string; image: Buffer; chart?: string }>();
const inflight = new Map<string, Promise<{ text: string; image: Buffer; chart?: string }>>();
const TTL = 30_000;
let budgetStarted = 0; let budgetUsed = 0;
const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const number = (v: unknown): number | null => v == null || (typeof v !== 'number' && typeof v !== 'string') || String(v).trim() === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
const price = (v: number) => `$${Number(v.toPrecision(8)).toString()}`;
const usd = (v: number) => v > 0 && v < 0.000001 ? price(v) : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toLocaleString("en-US", { maximumFractionDigits: v > 0 && v < 0.01 ? 6 : 2 })}`;
export function extractScanContract(text: string): string | null {
  const addresses = text.match(/(?<![A-Za-z0-9])0x[a-fA-F0-9]{40}(?![A-Za-z0-9])/g) ?? [];
  return addresses.length === 1 ? addresses[0].toLowerCase() : null;
}
export function renderContractScreen(token: string, pair: DexScreenerPair | null, pons?: PonsPublicContext | null, creatorBalance?: number | null, chainLabel = 'Robinchain', supply?: ResearchTokenSupply | null): string {
  const curveMarket = pons?.phase === 0 && pons.venue === 'curve';
  // A side pool is not the active launchpad market. Never mix its valuation,
  // liquidity, volume, trades or age into a pre-bond PONS report.
  if (curveMarket) pair = null;
  const rows: string[] = [];
  for (const [label, value] of [['Price', pair ? pair.priceUsd : pons?.priceUsd], ['MC', pair?.marketCap], ['FDV', pair?.marketCap == null ? (pair ? pair.fdv : pons?.fdvUsd) : null],
    ['LP liquidity', pair?.liquidity?.usd], ['Vol · 5m', pair?.volume?.m5]] as const) {
    const n = number(value); if (n != null) rows.push(`${label}  <b>${label === 'Price' ? price(n) : usd(n)}</b>`);
  }
  if (pons) {
    const supply = Number(pons.totalSupplyRaw) / 10 ** pons.decimals;
    if (Number.isFinite(supply) && supply > 0) rows.push(`Total supply  <b>${supply.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>`);
  }
  if (!pons && supply) rows.push(`Total supply  <b>${escape(formatResearchSupply(supply))}</b> · On-chain`);
  for (const [label, value] of [['Vol · 24h', pair?.volume?.h24]] as const) {
    const n = number(value); if (n != null) rows.push(`${label}  <b>${usd(n)}</b>`);
  }
  const hourMove = pair?.priceChange?.h1;
  if (hourMove != null && String(hourMove).trim() !== '' && Number.isFinite(Number(hourMove))) rows.push(`Move · 1h  <b>${Number(hourMove) >= 0 ? '+' : ''}${Number(hourMove).toFixed(2)}%</b>`);
  const buys = number(pair?.txns?.m5?.buys), sells = number(pair?.txns?.m5?.sells);
  if (buys != null && sells != null) rows.push(buys === 0 && sells === 0 ? 'Trades · 5m  <b>No trades reported</b>' : `Trades · 5m  <b>${buys} buy / ${sells} sell</b>`);
  const created = number(pair?.pairCreatedAt);
  if (created && created <= Date.now()) {
    const minutes = Math.floor((Date.now() - created) / 60_000);
    rows.push(`Pair age  <b>${minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`}</b>`);
  }
  const socials = extractAutomaticSocials({ socials: pair?.info?.socials, xUrl: pons?.twitter, telegramUrl: pons?.telegram });
  const links = [socials.xUrl ? `<a href="${escape(socials.xUrl).replace(/"/g, '&quot;')}">X</a>` : '',
    socials.telegramUrl ? `<a href="${escape(socials.telegramUrl).replace(/"/g, '&quot;')}">TG</a>` : ''].filter(Boolean);
  const symbol = pair?.baseToken?.symbol || pons?.symbol;
  const identity = `<b>${escape((pair?.baseToken?.name || pons?.name || 'Token report').slice(0, 32))}</b>${symbol ? ` ($${escape(symbol.slice(0, 16))})` : ''}`;
  const fixed = [identity, `${chainLabel} · Contract screen`, '',
    ...(curveMarket ? ['PONS bonding curve · Pre-bond snapshot'] : !pair && pons ? ['PONS snapshot · DEX market not indexed'] : []),
    ...(rows.length ? ['<b>📊 STATS</b>', ...rows] : ['Indexed market data could not be verified.']), '',
    ...(curveMarket ? ['FDV = price × total supply.', 'Curve liquidity, volume and age unavailable in this snapshot.', ''] : []),
    '<b>SOCIALS</b>', links.length && links.join(' · ').length < 180 ? links.join(' · ') : 'Not listed', '',
    ...(pons ? [`Creator · PONS page  <a href="https://robinhoodchain.blockscout.com/address/${pons.creator}">${pons.creator.slice(0, 6)}…${pons.creator.slice(-4)}</a>`] : []),
    ...(creatorBalance != null && Number.isFinite(creatorBalance) && creatorBalance >= 0 && creatorBalance <= 100 ? [`Creator balance  <b>${(creatorBalance === 0 ? '0.00' : creatorBalance < 0.01 ? '&lt;0.01' : creatorBalance.toFixed(2))}%</b> · On-chain`] : []),
    '🔒 Sellability, creator and holder risks not assessed.', '',
    `<code>${token}</code>`, 'Research only · DYOR',
    `${pair ? (pons ? 'DEXScreener + PONS page' : 'DEXScreener') : pons ? 'PONS page' : 'Lookup'} · Checked ${new Date().toISOString().slice(11, 19)} UTC`,
  ];
  // Telegram photo captions have a hard limit. Keep core facts and risk text;
  // shorten social labels/identity first instead of producing an undeliverable card.
  if (fixed.join('\n').length > 1024) fixed[fixed.indexOf('<b>SOCIALS</b>') + 1] = 'Open links via Full Intel';
  if (fixed.join('\n').length > 1024) fixed[0] = '<b>Token report</b>';
  return fixed.join('\n');
}
function prune(now: number): void {
  for (const [k, v] of reports) if (v.expires <= now) reports.delete(k);
  for (const [k, v] of groups) if (v <= now) groups.delete(k);
  for (const [k, v] of cooldowns) if (v <= now) cooldowns.delete(k);
}
export async function getRobinhoodContractReport(token: string, refresh = false) {
  const cached = reports.get(token); if (!refresh && cached && cached.expires > Date.now()) return cached;
  if (inflight.has(token)) return inflight.get(token)!;
  if (Date.now() - budgetStarted >= 60_000) { budgetStarted = Date.now(); budgetUsed = 0; }
  if (budgetUsed >= 10) throw new Error('Screening lookup budget reached');
  budgetUsed++;
  const work = (async () => {
    const pairs = await fetchRobinhoodPairs(token, { priority: 'NORMAL', caller: 'contract_screen', queueWaitTimeoutMs: 1_000 });
    const dexPair = chooseBestRobinhoodPair(pairs, token);
    const marker = await getSharedJson<{ factory?: string }>(`alphaos:pons:verified:${token}`);
    let factory = marker?.value.factory;
    if (!factory) {
      try {
        const { supabase } = await import('../services/supabase.js');
        const { data, error } = await supabase.from('pons_launches').select('factory_address')
          .eq('chain', 'robinhood').ilike('token_address', token).limit(1)
          .abortSignal(AbortSignal.timeout(1_000)).maybeSingle();
        if (!error && typeof data?.factory_address === 'string') factory = data.factory_address;
      } catch { /* Requested research remains available when the census is missing. */ }
    }
    const known = factory && getPonsFactoryDeployments().some(f => f.enabled && f.address.toLowerCase() === factory.toLowerCase());
    // Website metadata is sourced explicitly in requested research; it never
    // changes automatic launch/social eligibility or claims verified provenance.
    const pons = await (known ? getVerifiedPonsPublicContext(token, factory) : getReportedPonsPublicContext(token)).catch(() => null);
    const curveMarket = pons?.phase === 0 && pons.venue === 'curve';
    const pair = curveMarket ? null : dexPair;
    const creatorBalance = pons ? await getScreenCreatorBalance(token, pons.creator) : null;
    const supply = !pons && pair ? await readResearchTokenSupply(token, 'robinhood') : null;
    const text = renderContractScreen(token, pair, pons, creatorBalance, 'Robinchain', supply);
    const image = await buildAlphaosAlertCard({ title: pair?.baseToken?.symbol || pons?.symbol ? undefined : 'Contract research', symbol: pair?.baseToken?.symbol || pons?.symbol, name: pair?.baseToken?.name || pons?.name, logo: pons?.logo,
      category: 'CONTRACT SCREEN', chainLabel: 'ROBINCHAIN', badge: curveMarket ? 'PONS PRE-BOND' : !pair && pons ? 'PONS SNAPSHOT' : 'MARKET SNAPSHOT', footer: 'Requested contract research · Sourced market snapshot' });
    const result = { text, image, chart: curveMarket ? `https://www.ponsfamily.com/launchpad/${token}` : pair ? verifiedRobinhoodChartUrl(pair) : undefined };
    if (reports.size >= 50) reports.delete(reports.keys().next().value!);
    reports.set(token, { ...result, expires: Date.now() + TTL }); return result;
  })();
  inflight.set(token, work);
  try { return await work; } finally { inflight.delete(token); }
}
export function registerContractScreening(bot: Telegraf<any>, lookup = getRobinhoodContractReport): void {
  const timer = setInterval(() => prune(Date.now()), TTL); timer.unref();
  async function admin(ctx: any): Promise<boolean> {
    if (!ctx.chat || ctx.chat.type === 'private' || !ctx.from) return false;
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
    return ['creator', 'administrator'].includes(member.status);
  }
  bot.command('scan_on', async ctx => {
    if (!await admin(ctx)) { await ctx.reply('A group administrator must enable scanning.'); return; }
    prune(Date.now());
    if (groups.size >= 100 && !groups.has(String(ctx.chat.id))) { await ctx.reply('Group screening capacity reached.'); return; }
    groups.set(String(ctx.chat.id), Date.now() + 24 * 60 * 60_000);
    await ctx.reply('Robinchain contract screening enabled for 24 hours. Bare addresses are interpreted as Robinchain here. /scan_off disables it.');
  });
  bot.command('scan_off', async ctx => {
    if (!await admin(ctx)) return;
    groups.delete(String(ctx.chat.id)); await ctx.reply('Automatic contract screening disabled.');
  });
  async function scan(ctx: any, token: string, refresh = false): Promise<void> {
    const key = String(ctx.chat.id); prune(Date.now());
    if (cooldowns.has(key) || (inflight.size >= 3 && !inflight.has(token))) {
      if (refresh) await ctx.answerCbQuery('Please wait 15 seconds before refreshing.').catch(() => {});
      else await ctx.reply('Screening is busy. Please wait 15 seconds.'); return;
    }
    if (cooldowns.size >= 500) cooldowns.delete(cooldowns.keys().next().value!);
    cooldowns.set(key, Date.now() + 15_000);
    try {
      if (refresh) await ctx.answerCbQuery('Refreshing…').catch(() => {});
      const result = await lookup(token, refresh);
      const options = { caption: result.text, parse_mode: 'HTML' as const,
        reply_markup: { inline_keyboard: [
          [{ text: '↻ Refresh', callback_data: `SCAN_RH_${token}` }, { text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }],
          [{ text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${token}` }, ...(result.chart ? [{ text: '📊 Chart', url: result.chart }] : [])],
        ] } };
      if (refresh) await ctx.editMessageMedia({ type: 'photo', media: { source: result.image }, caption: result.text, parse_mode: 'HTML' }, { reply_markup: options.reply_markup });
      else await ctx.replyWithPhoto({ source: result.image }, { ...options, reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined });
    } catch (error) {
      if (refresh) {
        if (!/message is not modified/i.test(String(error))) await ctx.answerCbQuery('Refresh unavailable. Please try again shortly.', { show_alert: true }).catch(() => {});
      } else await ctx.reply('Screen could not be completed. No safety or trading conclusion was made.');
    }
  }
  bot.command('scan', async ctx => {
    const text = ctx.message.text.replace(/^\/scan(?:@\S+)?\s*/i, '');
    const token = extractScanContract(text);
    if (!token) { await ctx.reply('Use /scan robinhood <contract>. One contract per request.'); return; }
    if (!/^robin(?:hood|chain)\s/i.test(text)) {
      await ctx.reply('Confirm the chain: /scan robinhood <contract>. ARC and Solana screening are not available in this report yet.'); return;
    }
    await scan(ctx, token);
  });
  bot.action(/^SCAN_RH_(0x[a-fA-F0-9]{40})$/, async ctx => {
    await scan(ctx, ctx.match[1].toLowerCase(), true);
  });
  bot.on('text', async (ctx, next) => {
    if (!groups.has(String(ctx.chat.id))) return next();
    if ((groups.get(String(ctx.chat.id)) ?? 0) <= Date.now()) { groups.delete(String(ctx.chat.id)); return next(); }
    const token = extractScanContract(ctx.message.text);
    if (!token || ctx.message.text.startsWith('/')) return next();
    await scan(ctx, token);
  });
  console.log('[ContractScreen] READY chain=robinhood optInGroups=true concurrency=3 cacheSeconds=30');
}
