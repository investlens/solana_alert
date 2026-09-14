import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import type { DexProfile, RiskResult } from '../../types.js';
import { enrichToken, fetchBoostMap, fetchTakeoverSet } from '../../services/dexscreener.js';

const MAX_CONCURRENT = Math.max(1, Math.min(5, Number(process.env.PONS_FAST_LANE_CONCURRENCY ?? 2)));
const MAX_QUEUE = Math.max(5, Math.min(100, Number(process.env.PONS_FAST_LANE_MAX_QUEUE ?? 30)));
const CONFIRM_MS = Math.max(15_000, Number(process.env.PONS_FAST_LANE_CONFIRM_MS ?? 20_000));
const enabled = () => String(process.env.PONS_NORMAL_FAST_LANE_ENABLED ?? 'false').toLowerCase() === 'true';

let active = 0;
const queue: PonsLaunch[] = [];
const seen = new Set<string>();
let cacheAt = 0;
let boostMapCache: Awaited<ReturnType<typeof fetchBoostMap>> | null = null;
let takeoverSetCache: Awaited<ReturnType<typeof fetchTakeoverSet>> | null = null;

function tokenKey(launch: PonsLaunch): string {
  return String(launch.token_address ?? '').toLowerCase();
}

function bucket(result: RiskResult): 'HIGH_BUY' | 'BUY' | 'IGNORE' {
  const ratio = result.sells5m <= 0 ? result.buys5m : result.buys5m / result.sells5m;
  if (
    result.score >= 82 && result.marketSafetyScore >= 70 && result.authoritySafetyScore >= 0 &&
    result.liquidityUsd >= 8_000 && result.liquidityUsd <= 60_000 && result.volume5m >= 8_000 &&
    result.buys5m >= 100 && ratio >= 1.8 && result.ageMin <= 45
  ) return 'HIGH_BUY';
  if (
    result.score >= 78 && result.marketSafetyScore >= 60 && result.authoritySafetyScore >= 0 &&
    result.liquidityUsd >= 10_000 && result.liquidityUsd <= 65_000 && result.volume5m >= 5_000 &&
    result.buys5m >= 60 && ratio >= 1.6 && result.ageMin <= 75
  ) return 'BUY';
  return 'IGNORE';
}

async function maps() {
  if (!boostMapCache || !takeoverSetCache || Date.now() - cacheAt > 60_000) {
    [boostMapCache, takeoverSetCache] = await Promise.all([fetchBoostMap(), fetchTakeoverSet()]);
    cacheAt = Date.now();
  }
  return { boostMap: boostMapCache, takeoverSet: takeoverSetCache };
}

async function enrich(tokenAddress: string) {
  const { boostMap, takeoverSet } = await maps();
  const profile: DexProfile = { chainId: 'robinhood', tokenAddress };
  return enrichToken(profile, boostMap, takeoverSet);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function directAdminTelegram(text: string, tokenAddress: string): Promise<void> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '').trim();
  if (!botToken || !chatId) throw new Error('missing Telegram admin configuration');
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{
        text: '📈 DexScreener',
        url: `https://dexscreener.com/robinhood/${encodeURIComponent(tokenAddress)}`,
      }]] },
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text().catch(() => '')}`);
}

async function evaluate(launch: PonsLaunch): Promise<void> {
  const tokenAddress = tokenKey(launch);
  if (!tokenAddress) return;
  const first = await enrich(tokenAddress);
  if (!first) return;
  const firstBucket = bucket(first.result);
  if (firstBucket === 'IGNORE') {
    console.log(`[PonsFastLane] reject initial token=${tokenAddress} score=${first.result.score} safety=${first.result.marketSafetyScore}`);
    return;
  }

  await new Promise(resolve => setTimeout(resolve, CONFIRM_MS));
  const second = await enrich(tokenAddress);
  if (!second) return;
  const secondBucket = bucket(second.result);
  if (secondBucket === 'IGNORE') {
    console.log(`[PonsFastLane] reject confirmation token=${tokenAddress} bucket=IGNORE`);
    return;
  }

  const firstPrice = Number(first.result.currentPrice || 0);
  const secondPrice = Number(second.result.currentPrice || 0);
  const priceChangePct = firstPrice > 0 && secondPrice > 0 ? ((secondPrice - firstPrice) / firstPrice) * 100 : 0;
  const liquidityChangePct = first.result.liquidityUsd > 0
    ? ((second.result.liquidityUsd - first.result.liquidityUsd) / first.result.liquidityUsd) * 100 : 0;
  if (priceChangePct < -7 || priceChangePct > 20 || liquidityChangePct < -15 || second.result.buys5m < second.result.sells5m || second.result.score < first.result.score - 6) {
    console.log(`[PonsFastLane] reject momentum token=${tokenAddress} pricePct=${priceChangePct.toFixed(1)} liqPct=${liquidityChangePct.toFixed(1)}`);
    return;
  }

  const pair = second.pair;
  const ratio = second.result.sells5m <= 0 ? second.result.buys5m : second.result.buys5m / second.result.sells5m;
  const text = [
    `🚨 <b>AlphaOS PONS ${secondBucket}</b>`,
    `<b>${escapeHtml(pair.baseToken?.symbol ?? 'UNKNOWN')}</b> — ${escapeHtml(pair.baseToken?.name ?? '')}`,
    `Score: <b>${Math.round(second.result.score)}</b> | Safety: <b>${Math.round(second.result.marketSafetyScore)}</b>`,
    `Liquidity: <b>$${Math.round(second.result.liquidityUsd).toLocaleString()}</b> | 5m Vol: <b>$${Math.round(second.result.volume5m).toLocaleString()}</b>`,
    `Buys/Sells: <b>${second.result.buys5m}/${second.result.sells5m}</b> | Ratio: <b>${ratio.toFixed(2)}x</b>`,
    `Confirmation: price ${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}% | liquidity ${liquidityChangePct >= 0 ? '+' : ''}${liquidityChangePct.toFixed(1)}%`,
    `Developer: <b>UNVERIFIED</b> — no proven-dev bonus applied`,
    `<code>${escapeHtml(tokenAddress)}</code>`,
  ].join('\n');
  await directAdminTelegram(text, tokenAddress);
  console.log(`[PonsFastLane] ALERT_SENT token=${tokenAddress} bucket=${secondBucket} score=${second.result.score}`);
}

async function drain(): Promise<void> {
  while (active < MAX_CONCURRENT && queue.length) {
    const launch = queue.shift()!;
    active += 1;
    void evaluate(launch)
      .catch(error => console.warn(`[PonsFastLane] evaluation failed token=${tokenKey(launch)} reason=${error instanceof Error ? error.message : String(error)}`))
      .finally(() => { active -= 1; void drain(); });
  }
}

export function queuePonsNormalAlertFastLane(launch: PonsLaunch): void {
  if (!enabled()) return;
  const key = tokenKey(launch);
  if (!key || seen.has(key)) return;
  seen.add(key);
  if (queue.length >= MAX_QUEUE) {
    console.warn(`[PonsFastLane] queue full; dropping token=${key}`);
    return;
  }
  queue.push(launch);
  void drain();
}
