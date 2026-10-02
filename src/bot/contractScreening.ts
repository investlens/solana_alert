import { extractAutomaticSocials } from '../ui/alphaNotificationActions.js';
import type { Telegraf } from 'telegraf';
import { fetchRobinhoodPairs, chooseBestRobinhoodPair, verifiedRobinhoodChartUrl, type DexScreenerPair } from '../chains/robinhood/market.js';
import { buildAlphaosAlertCard } from '../ui/alphaosAlertCard.js';
import { getSharedJson } from '../services/sharedJsonCache.js';
import { getPonsFactoryDeployments } from '../chains/robinhood/ponsContracts.js';
import { getVerifiedPonsPublicContext, type PonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';

const groups = new Map<string, number>();
const cooldowns = new Map<string, number>();
const reports = new Map<string, { expires: number; text: string; image: Buffer; chart?: string }>();
const inflight = new Map<string, Promise<{ text: string; image: Buffer; chart?: string }>>();
const TTL = 30_000;
let budgetStarted = 0; let budgetUsed = 0;
const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const number = (v: unknown): number | null => v == null || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Number(v);
const usd = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v.toPrecision(5)}`;
export function extractScanContract(text: string): string | null {
  const addresses = text.match(/(?<![A-Za-z0-9])0x[a-fA-F0-9]{40}(?![A-Za-z0-9])/g) ?? [];
  return addresses.length === 1 ? addresses[0].toLowerCase() : null;
}
export function renderContractScreen(token: string, pair: DexScreenerPair | null, pons?: PonsPublicContext | null): string {
  const rows: string[] = [];
  for (const [label, value] of [['Price', pair ? pair.priceUsd : pons?.priceUsd], ['MC', pair?.marketCap], ['FDV', pair?.marketCap == null ? (pair ? pair.fdv : pons?.fdvUsd) : null],
    ['LP liquidity', pair?.liquidity?.usd], ['Vol · 5m', pair?.volume?.m5]] as const) {
    const n = number(value); if (n != null) rows.push(`${label}  <b>${usd(n)}</b>`);
  }
  if (pons) {
    const supply = Number(pons.totalSupplyRaw) / 10 ** pons.decimals;
    if (Number.isFinite(supply) && supply > 0) rows.push(`Total supply  <b>${supply.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b>`);
  }
  for (const [label, value] of [['Vol · 24h', pair?.volume?.h24]] as const) {
    const n = number(value); if (n != null) rows.push(`${label}  <b>${usd(n)}</b>`);
  }
  const hourMove = pair?.priceChange?.h1;
  if (hourMove != null && Number.isFinite(Number(hourMove))) rows.push(`Move · 1h  <b>${Number(hourMove) >= 0 ? '+' : ''}${Number(hourMove).toFixed(2)}%</b>`);
  const buys = number(pair?.txns?.m5?.buys), sells = number(pair?.txns?.m5?.sells);
  if (buys != null && sells != null) rows.push(`Trades · 5m  <b>${buys} buy / ${sells} sell</b>`);
  const created = number(pair?.pairCreatedAt);
  if (created && created <= Date.now()) rows.push(`Pair age  <b>${Math.floor((Date.now() - created) / 60_000)}m</b>`);
  const socials = extractAutomaticSocials({ socials: pair?.info?.socials, xUrl: pons?.twitter, telegramUrl: pons?.telegram });
  const links = [socials.xUrl ? `<a href="${escape(socials.xUrl).replace(/"/g, '&quot;')}">X</a>` : '',
    socials.telegramUrl ? `<a href="${escape(socials.telegramUrl).replace(/"/g, '&quot;')}">TG</a>` : ''].filter(Boolean);
  const symbol = pair?.baseToken?.symbol || pons?.symbol;
  const identity = `<b>${escape((pair?.baseToken?.name || pons?.name || 'Token report').slice(0, 32))}</b>${symbol ? ` ($${escape(symbol.slice(0, 16))})` : ''}`;
  const fixed = ['<b>ALPHAOS · CONTRACT SCREEN</b>', identity,
    'Robinchain · Requested research', '',
    ...(!pair && pons ? ['PONS snapshot · DEX market not indexed'] : []),
    ...(rows.length ? ['<b>📊 STATS</b>', ...rows] : ['Indexed market data could not be verified.']), '',
    '<b>SOCIALS</b>', links.length && links.join(' · ').length < 180 ? links.join(' · ') : 'Not listed', '',
    '<b>🔒 SECURITY</b>', 'Market snapshot only · Sellability, creator and holder risks not assessed.', '',
    `<code>${token}</code>`, 'Not an automatic trade alert · DYOR',
    `${pair ? 'DEXScreener' : pons ? 'PONS page' : 'Lookup'} · Checked ${new Date().toISOString().slice(11, 19)} UTC`,
  ];
  // Telegram photo captions have a hard limit. Keep core facts and risk text;
  // shorten social labels/identity first instead of producing an undeliverable card.
  if (fixed.join('\n').length > 1024) fixed[fixed.indexOf('<b>SOCIALS</b>') + 1] = 'Open links via Full Intel';
  if (fixed.join('\n').length > 1024) fixed[1] = '<b>Token report</b>';
  return fixed.join('\n');
}
function prune(now: number): void {
  for (const [k, v] of reports) if (v.expires <= now) reports.delete(k);
  for (const [k, v] of groups) if (v <= now) groups.delete(k);
  for (const [k, v] of cooldowns) if (v <= now) cooldowns.delete(k);
}
async function report(token: string) {
  const cached = reports.get(token); if (cached && cached.expires > Date.now()) return cached;
  if (inflight.has(token)) return inflight.get(token)!;
  if (Date.now() - budgetStarted >= 60_000) { budgetStarted = Date.now(); budgetUsed = 0; }
  if (budgetUsed >= 10) throw new Error('Screening lookup budget reached');
  budgetUsed++;
  const work = (async () => {
    const pairs = await fetchRobinhoodPairs(token, { priority: 'NORMAL', caller: 'contract_screen', queueWaitTimeoutMs: 1_000 });
    const pair = chooseBestRobinhoodPair(pairs, token);
    const marker = await getSharedJson<{ factory?: string }>(`alphaos:pons:verified:${token}`);
    const factory = marker?.value.factory;
    const known = factory && getPonsFactoryDeployments().some(f => f.enabled && f.address.toLowerCase() === factory.toLowerCase());
    const pons = known ? await getVerifiedPonsPublicContext(token, factory).catch(() => null) : null;
    const text = renderContractScreen(token, pair, pons);
    const image = await buildAlphaosAlertCard({ symbol: pair?.baseToken?.symbol || pons?.symbol, name: pair?.baseToken?.name || pons?.name, logo: pons?.logo,
      category: 'CONTRACT SCREEN', chainLabel: 'ROBINCHAIN', badge: !pair && pons ? 'PONS SNAPSHOT' : 'MARKET SNAPSHOT', footer: 'Requested research. Sellability, creator and holder risks not assessed.' });
    const result = { text, image, chart: pair ? verifiedRobinhoodChartUrl(pair) : undefined };
    if (reports.size >= 50) reports.delete(reports.keys().next().value!);
    reports.set(token, { ...result, expires: Date.now() + TTL }); return result;
  })();
  inflight.set(token, work);
  try { return await work; } finally { inflight.delete(token); }
}
export function registerContractScreening(bot: Telegraf<any>): void {
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
  async function scan(ctx: any, token: string): Promise<void> {
    const key = String(ctx.chat.id); prune(Date.now());
    if (cooldowns.has(key) || (inflight.size >= 3 && !inflight.has(token))) {
      await ctx.reply('Screening is busy. Please wait 15 seconds.'); return;
    }
    if (cooldowns.size >= 500) cooldowns.delete(cooldowns.keys().next().value!);
    cooldowns.set(key, Date.now() + 15_000);
    try {
      const result = await report(token);
      await ctx.replyWithPhoto({ source: result.image }, { caption: result.text, parse_mode: 'HTML',
        reply_parameters: ctx.message ? { message_id: ctx.message.message_id } : undefined,
        reply_markup: { inline_keyboard: [
          [{ text: '↻ Refresh', callback_data: `SCAN_RH_${token}` }, { text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }],
          [{ text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${token}` }, ...(result.chart ? [{ text: '📊 Chart', url: result.chart }] : [])],
        ] } });
    } catch { await ctx.reply('Screen could not be completed. No safety or trading conclusion was made.'); }
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
    await ctx.answerCbQuery().catch(() => {}); await scan(ctx, ctx.match[1].toLowerCase());
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
