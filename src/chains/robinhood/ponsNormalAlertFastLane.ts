import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import type { DexPair, DexProfile, RiskResult } from '../../types.js';
import { chooseBestPair, fetchPairs } from '../../services/dexscreener.js';
import { scoreToken } from '../../core/scoring.js';
import { getDeliverableUsers } from '../../core/delivery.js';
import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';
import { requestRobinhoodRpcResilient } from './rpc.js';
import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { getRobinhoodTokenSocials, type RobinhoodTokenSocials } from './tokenMetadata.js';

const MAX_CONCURRENT = Math.max(1, Math.min(5, Number(process.env.PONS_FAST_LANE_CONCURRENCY ?? 2)));
const MAX_QUEUE = Math.max(5, Math.min(100, Number(process.env.PONS_FAST_LANE_MAX_QUEUE ?? 30)));
const CONFIRM_MS = Math.max(15_000, Number(process.env.PONS_FAST_LANE_CONFIRM_MS ?? 20_000));
const RECIPIENT_CACHE_MS = Math.max(60_000, Number(process.env.PONS_FAST_LANE_RECIPIENT_CACHE_MS ?? 300_000));
const RETRY_MS = Math.max(5_000, Number(process.env.PONS_FAST_LANE_RETRY_MS ?? 15_000));
const MAX_TRANSIENT_RETRIES = Math.max(1, Math.min(8, Number(process.env.PONS_FAST_LANE_MAX_RETRIES ?? 4)));
const enabled = () => String(process.env.PONS_NORMAL_FAST_LANE_ENABLED ?? 'false').toLowerCase() === 'true';
const FOLLOWUP_ENABLED = String(process.env.PONS_LEAN_FOLLOWUP_ENABLED ?? 'false').toLowerCase() === 'true';
const FOLLOWUP_INTERVAL_MS = Math.max(60_000, Number(process.env.PONS_LEAN_FOLLOWUP_INTERVAL_MS ?? 90_000));
const FOLLOWUP_TTL_MS = Math.max(5 * 60_000, Number(process.env.PONS_LEAN_FOLLOWUP_TTL_MS ?? 20 * 60_000));
const FOLLOWUP_MAX = Math.max(3, Math.min(20, Number(process.env.PONS_LEAN_FOLLOWUP_MAX ?? 10)));

let active = 0;
const queue: PonsLaunch[] = [];
const seen = new Set<string>();
const retryAttempts = new Map<string, number>();
const noPairRetries = new Set<string>();
const NO_PAIR_RETRY_MS = Math.max(30_000, Math.min(120_000, Number(process.env.PONS_NO_PAIR_RETRY_MS ?? 45_000)));
const PREINDEX_MAX = 10;
const PREINDEX_RECHECK_MS = Math.max(15_000, Number(process.env.PONS_CURVE_TREND_CONFIRM_MS ?? 30_000));
const PONS_MIN_ALERT_AGE_MS = Math.max(5 * 60_000, Number(process.env.PONS_MIN_ALERT_AGE_MS ?? 30 * 60_000));
const PONS_CURVE_MIN_QUOTE_GROWTH_PCT = Number(process.env.PONS_CURVE_MIN_QUOTE_GROWTH_PCT ?? 3);
const PONS_CURVE_STRONG_QUOTE_GROWTH_PCT = Number(process.env.PONS_CURVE_STRONG_QUOTE_GROWTH_PCT ?? 8);
const PREINDEX_ABI = parseAbi([
  'function token() view returns (address)',
  'function getReserves() view returns (uint256 quoteReserve,uint256 tokenReserve)',
  'function graduated() view returns (bool)',
]);
const preIndexCandidates = new Set<string>();
const preIndexAlerted = new Set<string>();
let recipientCacheAt = 0;
let recipientRefreshInFlight: Promise<void> | null = null;
let recipientCache = new Set<string>();

type LeanFollowup = {
  token: string;
  symbol: string;
  name: string;
  firstSeenAt: number;
  expiresAt: number;
  lastCheckedAt: number;
  lastPrice: number;
  lastScore: number;
  lastRatio: number;
  lastBucket: 'HIGH_BUY' | 'BUY' | 'IGNORE';
  weakestRatio: number;
  lowestScore: number;
  opportunitySent: boolean;
  reversalSent: boolean;
};

const leanFollowups = new Map<string, LeanFollowup>();
let followupTimer: ReturnType<typeof setInterval> | null = null;
let followupRunning = false;

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

async function fetchBroadRobinhoodPairs(tokenAddress: string): Promise<DexPair[]> {
  const url = `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`;
  const payload = (await governedDexScreenerJson<any>({
    url,
    caller: 'pons_fast_lane_fallback',
    endpoint: 'PONS_TOKEN_LOOKUP',
    priority: 'HIGH',
    cacheKey: `pons-fallback:${tokenAddress.toLowerCase()}`,
    cacheTtlMs: 10_000,
    signal: AbortSignal.timeout(8_000),
  })).value;
  const pairs: DexPair[] = Array.isArray(payload?.pairs) ? payload.pairs : [];
  return pairs.filter(pair => String((pair as any).chainId ?? '').toLowerCase() === 'robinhood');
}

async function enrich(tokenAddress: string, broadFallback = false) {
  const profile: DexProfile = { chainId: 'robinhood', tokenAddress };
  const pairs = broadFallback
    ? await fetchBroadRobinhoodPairs(tokenAddress)
    : await fetchPairs(tokenAddress);
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

async function sendTelegram(chatId: string, text: string, tokenAddress: string, socials?: RobinhoodTokenSocials, preBond = false): Promise<void> {
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
      reply_markup: { inline_keyboard: [
        [
          preBond
            ? { text: '🚀 PONS', url: `https://www.ponsfamily.com/launchpad/${encodeURIComponent(tokenAddress)}` }
            : { text: '📈 Chart', url: `https://dexscreener.com/robinhood/${encodeURIComponent(tokenAddress)}` },
          { text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(tokenAddress)}` },
        ],
        [
          ...(socials?.website ? [{ text: '🌐 Project', url: socials.website }] : []),
          ...(socials?.twitter ? [{ text: '𝕏 X', url: socials.twitter }] : []),
          ...(socials?.telegram ? [{ text: '✈️ TG', url: socials.telegram }] : []),
        ],
      ].filter(row => row.length > 0) },
    }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text().catch(() => '')}`);
}

async function directTelegramRecipients(text: string, tokenAddress: string, socials?: RobinhoodTokenSocials, preBond = false): Promise<{ delivered: number; failed: number }> {
  ensureAdminRecipient();
  refreshRecipientsInBackground();
  const recipients = [...recipientCache];
  if (!recipients.length) throw new Error('no Telegram recipients available');

  const results = await Promise.allSettled(recipients.map(chatId => sendTelegram(chatId, text, tokenAddress, socials, preBond)));
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


async function readPonsV2Curve(launch: PonsLaunch): Promise<{ quoteReserve: bigint; tokenReserve: bigint; graduated: boolean } | null> {
  const token = tokenKey(launch);
  const curve = String(launch.curve_address ?? '').trim();
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(curve)) return null;
  try {
    const readCurve = async (functionName: 'token' | 'getReserves' | 'graduated') => {
      const data = encodeFunctionData({ abi: PREINDEX_ABI, functionName } as any);
      let raw: unknown;
      let lastError: unknown;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          raw = await requestRobinhoodRpcResilient({ method: 'eth_call', params: [{ to: curve, data }, 'latest'] });
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      if (!raw) throw lastError ?? new Error('PONS curve eth_call returned no result');
      return decodeFunctionResult({ abi: PREINDEX_ABI, functionName, data: raw as `0x${string}` } as any);
    };
    const [curveToken, reserves, graduated] = await Promise.all([readCurve('token'), readCurve('getReserves'), readCurve('graduated')]);
    const [quoteReserve, tokenReserve] = reserves as readonly [bigint, bigint];
    if (String(curveToken).toLowerCase() !== token || quoteReserve <= 0n || tokenReserve <= 0n) return null;
    return { quoteReserve, tokenReserve, graduated: Boolean(graduated) };
  } catch (error) {
    console.warn(`[PonsFastLane] curve read failed token=${token} reason=${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function validatePonsV2Curve(launch: PonsLaunch): Promise<boolean> {
  const token = tokenKey(launch);
  const snapshot = await readPonsV2Curve(launch);
  const valid = !!snapshot && !snapshot.graduated;
  if (valid && snapshot) {
    console.log(`[PonsFastLane] PREINDEX_CURVE_VALID token=${token} curve=${String(launch.curve_address ?? '')} quoteReserve=${snapshot.quoteReserve.toString()} tokenReserve=${snapshot.tokenReserve.toString()} action=CURVE_TREND_WATCH`);
  }
  return valid;
}

function schedulePreIndexRecheck(launch: PonsLaunch): void {
  const token = tokenKey(launch);
  if (!token || preIndexCandidates.has(token) || preIndexAlerted.has(token) || preIndexCandidates.size >= PREINDEX_MAX) return;
  preIndexCandidates.add(token);

  const launchedAt = Date.parse(launch.block_timestamp);
  const ageMs = Number.isFinite(launchedAt) ? Math.max(0, Date.now() - launchedAt) : 0;
  const maturityWaitMs = Math.max(0, PONS_MIN_ALERT_AGE_MS - ageMs);
  console.log(`[PonsFastLane] MATURITY_WATCH token=${token} ageMin=${(ageMs / 60_000).toFixed(1)} waitMin=${(maturityWaitMs / 60_000).toFixed(1)}`);

  setTimeout(() => {
    void (async () => {
      const baseline = await readPonsV2Curve(launch);
      if (!baseline || baseline.graduated) {
        preIndexCandidates.delete(token);
        return;
      }
      setTimeout(() => {
        void (async () => {
          try {
            const second = await readPonsV2Curve(launch);
            if (!second || second.graduated) return;
            const quoteGrowthPct = Number((second.quoteReserve - baseline.quoteReserve) * 10_000n / baseline.quoteReserve) / 100;
            const tokenReserveChangePct = Number((second.tokenReserve - baseline.tokenReserve) * 10_000n / baseline.tokenReserve) / 100;
            const upward = quoteGrowthPct >= PONS_CURVE_MIN_QUOTE_GROWTH_PCT && tokenReserveChangePct < 0;
            if (!upward) {
              console.log(`[PonsFastLane] MATURE_TREND_REJECT token=${token} quoteGrowthPct=${quoteGrowthPct.toFixed(2)} tokenReservePct=${tokenReserveChangePct.toFixed(2)}`);
              return;
            }

            const devFlow = await scanRobinhoodDevTokenFlow(token, launch.deployer_address);
            const devMoved = (devFlow.otherDevTransferPercent ?? 0) > 0;
            const devBurned = (devFlow.confirmedDevBurnPercent ?? 0) > 0;
            const devHolding = devFlow.devHoldingPercent;
            // Alert only when we can positively establish that the dev still holds tokens
            // or that the dev burned supply. Unknown/zero holding is not enough evidence.
            const devSafe = devBurned || (devHolding != null && devHolding > 0 && !devMoved);
            if (!devSafe) {
              console.log(`[PonsFastLane] MATURE_TREND_REJECT_DEV token=${token} holdingPct=${devHolding ?? 'unknown'} burnedPct=${devFlow.confirmedDevBurnPercent ?? 0} movedPct=${devFlow.otherDevTransferPercent ?? 0}`);
              return;
            }

            const strong = quoteGrowthPct >= PONS_CURVE_STRONG_QUOTE_GROWTH_PCT;
            const curveMarketCapEth = (Number(second.quoteReserve) / Number(second.tokenReserve)) * 1_000_000_000;
            const shortCa = token.length > 14 ? `${token.slice(0, 8)}…${token.slice(-6)}` : token;
            const ageMin = Number.isFinite(launchedAt) ? Math.max(30, Math.floor((Date.now() - launchedAt) / 60_000)) : 30;
            const text = [
              strong ? '🔥 <b>AlphaOS · PONS SUSTAINED MOMENTUM</b>' : '🚀 <b>AlphaOS · PONS TREND REVERSAL</b>',
              '━━━━━━━━━━━━━━━━━━',
              `🪙 <b>Verified PONS Launch</b>  ·  <code>${shortCa}</code>`,
              `<code>${escapeHtml(token)}</code>`,
              '',
              `🕒 Launch age       <b>${ageMin}m+</b>`,
              `📈 Fresh trend       <b>+${quoteGrowthPct.toFixed(2)}%</b>`,
              `🧮 Token reserve     <b>${tokenReserveChangePct.toFixed(2)}%</b>`,
              `💰 Curve Market Cap  <b>${curveMarketCapEth.toFixed(3)} ETH</b>`,
              '',
              '🎯 <b>WHY ALPHAOS FLAGGED IT</b>',
              '✅ Survived the high-risk first 30 minutes',
              `🟢 Fresh buying trend confirmed over ${Math.round(PREINDEX_RECHECK_MS / 1000)}s`,
              ...(devHolding != null && devHolding > 0 ? [`👨‍💻 Dev still holding <b>${devHolding.toFixed(2)}%</b>`] : []),
              ...(devBurned ? [`🔥 Verified dev burn <b>${devFlow.confirmedDevBurnPercent!.toFixed(2)}%</b>`] : []),
              '',
              '🛡️ <b>PONS LAUNCHPAD</b>',
              '✅ Verified PONS bonding curve',
              '<i>Market/dump risk still applies · AlphaOS</i>',
            ].join('\n');
            const socials = await getRobinhoodTokenSocials(token);
            const delivery = await directTelegramRecipients(text, token, socials, true);
            preIndexAlerted.add(token);
            console.log(`[PonsFastLane] MATURE_CURVE_ALERT_SENT token=${token} ageMin=${ageMin} quoteGrowthPct=${quoteGrowthPct.toFixed(2)} delivered=${delivery.delivered} failed=${delivery.failed}`);
          } finally {
            preIndexCandidates.delete(token);
          }
        })();
      }, PREINDEX_RECHECK_MS);
    })();
  }, maturityWaitMs);
}

async function evaluate(launch: PonsLaunch): Promise<void> {
  const tokenAddress = tokenKey(launch);
  if (!tokenAddress) return;
  const isNoPairRetry = noPairRetries.has(tokenAddress);
  const first = await enrich(tokenAddress, isNoPairRetry);
  if (!first) {
    if (!isNoPairRetry) {
      noPairRetries.add(tokenAddress);
      console.log(`[PonsFastLane] no indexed pair yet; broad retry scheduled token=${tokenAddress} delayMs=${NO_PAIR_RETRY_MS}`);
      setTimeout(() => {
        queue.push(launch);
        void drain();
      }, NO_PAIR_RETRY_MS);
    } else {
      console.log(`[PonsFastLane] no verified pair after broad retry token=${tokenAddress}`);
      noPairRetries.delete(tokenAddress);
      if (preIndexCandidates.size < PREINDEX_MAX && launch.protocol_version.startsWith('v2') && launch.curve_address) {
        const curveValid = await validatePonsV2Curve(launch);
        if (curveValid) schedulePreIndexRecheck(launch);
      }
    }
    return;
  }
  if (isNoPairRetry) {
    console.log(`[PonsFastLane] BROAD_PAIR_RESOLVED token=${tokenAddress} pair=${String((first.pair as any).pairAddress ?? 'unknown')}`);
  }
  noPairRetries.delete(tokenAddress);
  const firstBucket = bucket(first.result);
  registerLeanFollowup(tokenAddress, first.pair, first.result);
  ensureLeanFollowupLoop();
  if (firstBucket === 'IGNORE') {
    console.log(`[PonsFastLane] reject initial token=${tokenAddress} score=${first.result.score} safety=${first.result.marketSafetyScore}`);
    return;
  }

  await new Promise(resolve => setTimeout(resolve, CONFIRM_MS));
  const second = await enrich(tokenAddress);
  if (!second) return;
  const secondBucket = bucket(second.result);
  registerLeanFollowup(tokenAddress, second.pair, second.result);
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

  // Expensive developer enrichment happens only after the token has passed
  // market criteria + confirmation. Weak launches never reach this RPC stage.
  const devFlow = await scanRobinhoodDevTokenFlow(tokenAddress);
  const devSoldOrMoved = (devFlow.otherDevTransferPercent ?? 0) > 0;
  if (devSoldOrMoved) {
    console.log(`[PonsFastLane] reject developer movement token=${tokenAddress} transferredPct=${devFlow.otherDevTransferPercent}`);
    return;
  }

  const pair = second.pair;
  const ratio = second.result.sells5m <= 0 ? second.result.buys5m : second.result.buys5m / second.result.sells5m;
  const evidence = [
    priceChangePct >= 0 ? `✓ Price holding/rising (${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}%)` : null,
    liquidityChangePct >= -5 ? `✓ Liquidity stable (${liquidityChangePct >= 0 ? '+' : ''}${liquidityChangePct.toFixed(1)}%)` : null,
    ratio >= 1.6 ? `✓ Buy pressure ${ratio.toFixed(2)}x` : null,
    devFlow.devHoldingPercent != null ? `✓ Dev holding ${devFlow.devHoldingPercent.toFixed(2)}%` : null,
    (devFlow.confirmedDevBurnPercent ?? 0) > 0 ? `🔥 Verified dev burn ${devFlow.confirmedDevBurnPercent!.toFixed(2)}%` : null,
  ].filter(Boolean);
  const symbol = escapeHtml(pair.baseToken?.symbol ?? 'UNKNOWN');
  const name = escapeHtml(pair.baseToken?.name ?? '');
  const shortCa = tokenAddress.length > 14
    ? `${tokenAddress.slice(0, 8)}…${tokenAddress.slice(-6)}`
    : tokenAddress;
  const text = [
    `🚀 <b>AlphaOS · PONS ${secondBucket}</b>`,
    '━━━━━━━━━━━━━━━━━━',
    `🔥 <b>${symbol}</b>  ·  <code>${shortCa}</code>`,
    ...(name ? [`<i>${name}</i>`] : []),
    `<code>${escapeHtml(tokenAddress)}</code>`,
    '',
    `⭐ AlphaOS Score  <b>${Math.round(second.result.score)}</b>`,
    `🛡️ Safety Score   <b>${Math.round(second.result.marketSafetyScore)}</b>`,
    `💧 Liquidity      <b>${Math.round(second.result.liquidityUsd).toLocaleString()}</b>`,
    `📊 5m Volume      <b>${Math.round(second.result.volume5m).toLocaleString()}</b>`,
    `🟢 Buys / Sells   <b>${second.result.buys5m} / ${second.result.sells5m}</b>  ·  <b>${ratio.toFixed(2)}x</b>`,
    '',
    '🎯 <b>WHY ALPHAOS FLAGGED IT</b>',
    ...(evidence.length ? evidence : ['✅ Market criteria confirmed']),
    '',
    '🛡️ <b>PONS LAUNCHPAD</b>',
    '✅ Verified PONS launch',
    ...(devFlow.devHoldingPercent != null ? [`👨‍💻 Dev holding <b>${devFlow.devHoldingPercent.toFixed(2)}%</b>`] : []),
    ...((devFlow.confirmedDevBurnPercent ?? 0) > 0 ? [`🔥 Verified dev burn <b>${devFlow.confirmedDevBurnPercent!.toFixed(2)}%</b>`] : []),
    '',
    '<i>AlphaOS · Find. Analyse. Trade Smarter.</i>',
  ].join('\n');
  const socials = await getRobinhoodTokenSocials(tokenAddress);
  const delivery = await directTelegramRecipients(text, tokenAddress, socials);
  console.log(`[PonsFastLane] ALERT_SENT token=${tokenAddress} bucket=${secondBucket} score=${second.result.score} delivered=${delivery.delivered} failed=${delivery.failed}`);
}


function ratioOf(result: RiskResult): number {
  return result.sells5m <= 0 ? (result.buys5m > 0 ? 99 : 0) : result.buys5m / result.sells5m;
}

function followupEligible(result: RiskResult): boolean {
  const ratio = ratioOf(result);
  return bucket(result) !== 'IGNORE' || (
    result.score >= 65 &&
    result.marketSafetyScore >= 50 &&
    result.liquidityUsd >= 5_000 &&
    result.volume5m >= 1_500 &&
    result.buys5m >= 20 &&
    ratio >= 0.75
  );
}

function registerLeanFollowup(tokenAddress: string, pair: any, result: RiskResult): void {
  if (!FOLLOWUP_ENABLED || !followupEligible(result)) return;
  const now = Date.now();
  const ratio = ratioOf(result);
  const existing = leanFollowups.get(tokenAddress);
  const next: LeanFollowup = existing ?? {
    token: tokenAddress,
    symbol: String(pair?.baseToken?.symbol ?? 'UNKNOWN'),
    name: String(pair?.baseToken?.name ?? ''),
    firstSeenAt: now,
    expiresAt: now + FOLLOWUP_TTL_MS,
    lastCheckedAt: 0,
    lastPrice: Number(result.currentPrice || 0),
    lastScore: result.score,
    lastRatio: ratio,
    lastBucket: bucket(result),
    weakestRatio: ratio,
    lowestScore: result.score,
    opportunitySent: false,
    reversalSent: false,
  };
  next.symbol = String(pair?.baseToken?.symbol ?? next.symbol);
  next.name = String(pair?.baseToken?.name ?? next.name);
  next.lastPrice = Number(result.currentPrice || next.lastPrice || 0);
  next.lastScore = result.score;
  next.lastRatio = ratio;
  next.lastBucket = bucket(result);
  next.weakestRatio = Math.min(next.weakestRatio, ratio);
  next.lowestScore = Math.min(next.lowestScore, result.score);
  next.expiresAt = Math.max(next.expiresAt, now + FOLLOWUP_TTL_MS);
  leanFollowups.set(tokenAddress, next);

  if (leanFollowups.size > FOLLOWUP_MAX) {
    const oldest = [...leanFollowups.values()].sort((a, b) => a.firstSeenAt - b.firstSeenAt)[0];
    if (oldest) leanFollowups.delete(oldest.token);
  }
}

async function sendLeanFollowupAlert(kind: 'OPPORTUNITY' | 'REVERSAL', item: LeanFollowup, pair: any, result: RiskResult): Promise<void> {
  const currentBucket = bucket(result);
  const ratio = ratioOf(result);
  const price = Number(result.currentPrice || 0);
  const pricePct = item.lastPrice > 0 && price > 0 ? ((price - item.lastPrice) / item.lastPrice) * 100 : 0;
  const shortCa = item.token.length > 14 ? `${item.token.slice(0, 8)}…${item.token.slice(-6)}` : item.token;
  const text = [
    kind === 'REVERSAL' ? '🔄 <b>AlphaOS · PONS TREND REVERSAL</b>' : '🎯 <b>AlphaOS · PONS OPPORTUNITY</b>',
    '━━━━━━━━━━━━━━━━━━',
    `🚀 <b>${escapeHtml(pair?.baseToken?.symbol ?? item.symbol)}</b>  ·  <code>${shortCa}</code>`,
    `<code>${escapeHtml(item.token)}</code>`,
    '',
    `⭐ State / Score   <b>${currentBucket} · ${Math.round(result.score)}</b>`,
    `🛡️ Safety Score   <b>${Math.round(result.marketSafetyScore)}</b>`,
    `💧 Liquidity      <b>${Math.round(result.liquidityUsd).toLocaleString()}</b>`,
    `📊 5m Volume      <b>${Math.round(result.volume5m).toLocaleString()}</b>`,
    `🟢 Buys / Sells   <b>${result.buys5m} / ${result.sells5m}</b>  ·  <b>${ratio.toFixed(2)}x</b>`,
    `📈 Latest move    <b>${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(1)}%</b>`,
    '',
    '🎯 <b>WHY ALPHAOS FLAGGED IT</b>',
    kind === 'REVERSAL'
      ? `🔄 Recovery: score ${Math.round(item.lowestScore)} → ${Math.round(result.score)} · buy pressure ${item.weakestRatio.toFixed(2)}x → ${ratio.toFixed(2)}x`
      : '✅ Fresh launch strengthened into AlphaOS opportunity criteria',
    '',
    '🛡️ <b>PONS LAUNCHPAD</b>',
    '✅ Verified PONS launch',
    '',
    '<i>AlphaOS · Find. Analyse. Trade Smarter.</i>',
  ].join('\n');
  const socials = await getRobinhoodTokenSocials(item.token);
  const delivery = await directTelegramRecipients(text, item.token, socials);
  console.log(`[PonsLeanFollowup] ${kind}_ALERT_SENT token=${item.token} bucket=${currentBucket} score=${result.score} delivered=${delivery.delivered} failed=${delivery.failed}`);
}

async function runLeanFollowups(): Promise<void> {
  if (!FOLLOWUP_ENABLED || followupRunning || leanFollowups.size === 0) return;
  followupRunning = true;
  try {
    const now = Date.now();
    for (const [token, item] of leanFollowups) {
      if (Date.now() > item.expiresAt) {
        leanFollowups.delete(token);
        continue;
      }
      if (now - item.lastCheckedAt < FOLLOWUP_INTERVAL_MS) continue;
      item.lastCheckedAt = now;
      try {
        const current = await enrich(token);
        if (!current) continue;
        const currentBucket = bucket(current.result);
        const currentRatio = ratioOf(current.result);
        const recovered = item.lastBucket === 'IGNORE' &&
          currentBucket !== 'IGNORE' &&
          current.result.score >= item.lowestScore + 6 &&
          currentRatio >= 1.4 &&
          item.weakestRatio < 1.2;
        const opportunity = currentBucket !== 'IGNORE' && !item.opportunitySent;

        if (recovered && !item.reversalSent) {
          await sendLeanFollowupAlert('REVERSAL', item, current.pair, current.result);
          item.reversalSent = true;
          item.opportunitySent = true;
        } else if (opportunity) {
          await sendLeanFollowupAlert('OPPORTUNITY', item, current.pair, current.result);
          item.opportunitySent = true;
        }

        item.lastPrice = Number(current.result.currentPrice || item.lastPrice || 0);
        item.lastScore = current.result.score;
        item.lastRatio = currentRatio;
        item.lastBucket = currentBucket;
        item.weakestRatio = Math.min(item.weakestRatio, currentRatio);
        item.lowestScore = Math.min(item.lowestScore, current.result.score);

        if (item.opportunitySent && item.reversalSent) leanFollowups.delete(token);
      } catch (error) {
        console.warn(`[PonsLeanFollowup] check failed token=${token} reason=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    followupRunning = false;
  }
}

function ensureLeanFollowupLoop(): void {
  if (!FOLLOWUP_ENABLED || followupTimer) return;
  followupTimer = setInterval(() => { void runLeanFollowups(); }, FOLLOWUP_INTERVAL_MS);
  console.log(`[PonsLeanFollowup] enabled intervalMs=${FOLLOWUP_INTERVAL_MS} ttlMs=${FOLLOWUP_TTL_MS} max=${FOLLOWUP_MAX} dbWrites=0`);
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
