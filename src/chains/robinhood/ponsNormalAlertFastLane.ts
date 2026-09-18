import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import type { DexProfile, RiskResult } from '../../types.js';
import { chooseBestPair, fetchPairs } from '../../services/dexscreener.js';
import { scoreToken } from '../../core/scoring.js';
import { getDeliverableUsers } from '../../core/delivery.js';

const MAX_CONCURRENT = Math.max(1, Math.min(5, Number(process.env.PONS_FAST_LANE_CONCURRENCY ?? 2)));
const MAX_QUEUE = Math.max(5, Math.min(100, Number(process.env.PONS_FAST_LANE_MAX_QUEUE ?? 30)));
const CONFIRM_MS = Math.max(15_000, Number(process.env.PONS_FAST_LANE_CONFIRM_MS ?? 20_000));
const RECIPIENT_CACHE_MS = Math.max(60_000, Number(process.env.PONS_FAST_LANE_RECIPIENT_CACHE_MS ?? 300_000));
const RETRY_MS = Math.max(5_000, Number(process.env.PONS_FAST_LANE_RETRY_MS ?? 15_000));
const MAX_TRANSIENT_RETRIES = Math.max(1, Math.min(8, Number(process.env.PONS_FAST_LANE_MAX_RETRIES ?? 4)));
const enabled = () => String(process.env.PONS_NORMAL_FAST_LANE_ENABLED ?? 'false').toLowerCase() === 'true';

let active = 0;
const queue: PonsLaunch[] = [];
const seen = new Set<string>();
const retryAttempts = new Map<string, number>();
let recipientCacheAt = 0;
let recipientRefreshInFlight: Promise<void> | null = null;
let recipientCache = new Set<string>();

function adminRecipient(): string {
  return String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '').trim();
}

function ensureAdminRecipient(): void {
  const adminId = adminRecipient();
  if (adminId) recipientCache.add(adminId);
}

ensureAdminRecipient();

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

async function enrich(tokenAddress: string) {
  const profile: DexProfile = { chainId: 'robinhood', tokenAddress };
  const pairs = await fetchPairs(tokenAddress);
  const pair = chooseBestPair(pairs, tokenAddress);
  if (!pair) return null;
  const result = await scoreToken({
    pair,
    profile,
    paidApproved: false,
    boostAmount: 0,
    hasTakeover: false,
  });
  return { pair, result };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function refreshRecipientsInBackground(): void {
  ensureAdminRecipient();
  if (recipientRefreshInFlight || Date.now() - recipientCacheAt < RECIPIENT_CACHE_MS) return;

  recipientRefreshInFlight = (async () => {
    try {
      const users = await getDeliverableUsers();
      const next = new Set<string>();
      const adminId = adminRecipient();
      if (adminId) next.add(adminId);
      for (const user of users) {
        const telegramId = String(user.telegram_id ?? '').trim();
        if (telegramId && !user.is_blocked) next.add(telegramId);
      }
      if (next.size > 0) {
        recipientCache = next;
        recipientCacheAt = Date.now();
        console.log(`[PonsFastLane] recipient cache refreshed count=${recipientCache.size}`);
      }
    } catch (error) {
      console.warn(`[PonsFastLane] recipient refresh failed; keeping cached recipients count=${recipientCache.size} reason=${error instanceof Error ? error.message : String(error)}`);
    } finally {
      recipientRefreshInFlight = null;
    }
  })();
}

async function sendTelegram(chatId: string, text: string, tokenAddress: string): Promise<void> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken || !chatId) throw new Error('missing Telegram configuration');
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

async function directTelegramRecipients(text: string, tokenAddress: string): Promise<{ delivered: number; failed: number }> {
  ensureAdminRecipient();
  refreshRecipientsInBackground();
  const recipients = [...recipientCache];
  if (!recipients.length) throw new Error('no Telegram recipients available');

  const results = await Promise.allSettled(recipients.map(chatId => sendTelegram(chatId, text, tokenAddress)));
  let delivered = 0;
  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      delivered += 1;
      return;
    }
    failed += 1;
    console.warn(`[PonsFastLane] TELEGRAM_FAILED token=${tokenAddress} recipient=${recipients[index]} reason=${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
  });
  if (delivered === 0) throw new Error(`Telegram delivery failed for all ${failed} recipients`);
  return { delivered, failed };
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
  const delivery = await directTelegramRecipients(text, tokenAddress);
  console.log(`[PonsFastLane] ALERT_SENT token=${tokenAddress} bucket=${secondBucket} score=${second.result.score} delivered=${delivery.delivered} failed=${delivery.failed}`);
}

function isTransientDexScreenerFailure(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  const normalized = reason.toLowerCase();
  return normalized.includes('dexscreener provider backoff')
    || normalized.includes('provider backoff active')
    || normalized.includes('queue capacity')
    || normalized.includes('queue full');
}

function scheduleTransientRetry(launch: PonsLaunch, error: unknown): boolean {
  if (!isTransientDexScreenerFailure(error)) return false;
  const key = tokenKey(launch);
  if (!key) return false;
  const attempt = (retryAttempts.get(key) ?? 0) + 1;
  if (attempt > MAX_TRANSIENT_RETRIES) {
    retryAttempts.delete(key);
    console.warn(`[PonsFastLane] transient retry exhausted token=${key} attempts=${attempt - 1}`);
    return false;
  }

  retryAttempts.set(key, attempt);
  const delayMs = RETRY_MS * attempt;
  console.warn(`[PonsFastLane] transient provider failure; retry scheduled token=${key} attempt=${attempt}/${MAX_TRANSIENT_RETRIES} delayMs=${delayMs}`);
  setTimeout(() => {
    if (queue.length >= MAX_QUEUE) {
      console.warn(`[PonsFastLane] retry queue full; rescheduling token=${key} attempt=${attempt}`);
      setTimeout(() => {
        if (queue.length < MAX_QUEUE) {
          queue.push(launch);
          void drain();
        }
      }, RETRY_MS);
      return;
    }
    queue.push(launch);
    void drain();
  }, delayMs);
  return true;
}

async function drain(): Promise<void> {
  while (active < MAX_CONCURRENT && queue.length) {
    const launch = queue.shift()!;
    const key = tokenKey(launch);
    active += 1;
    void evaluate(launch)
      .then(() => { if (key) retryAttempts.delete(key); })
      .catch(error => {
        if (!scheduleTransientRetry(launch, error)) {
          if (key) retryAttempts.delete(key);
          console.warn(`[PonsFastLane] evaluation failed token=${key} reason=${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => { active -= 1; void drain(); });
  }
}

export function queuePonsNormalAlertFastLane(launch: PonsLaunch): void {
  if (!enabled()) return;
  refreshRecipientsInBackground();
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
