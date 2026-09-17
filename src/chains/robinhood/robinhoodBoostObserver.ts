import { fetchRobinhoodBoosts } from './discovery.js';
import { boostMetadataFallback, resolveBoostMetadata } from './boostMetadataResolver.js';
import { sendTelegramWithMessageId } from '../../services/telegram.js';
import { config } from '../../config.js';

const BOOST_INTERVAL_MS = 15_000;
export const BOOSTED_OPPORTUNITY_THRESHOLD = 200;
export const MAJOR_BOOST_THRESHOLD = 500;

export function boostNotificationState(totalBoostAmount: number) {
  return totalBoostAmount >= BOOSTED_OPPORTUNITY_THRESHOLD
    ? 'BOOSTED_OPPORTUNITY' as const
    : 'BUILDING' as const;
}

export function boostPresentationState(totalBoostAmount: number) {
  return totalBoostAmount >= MAJOR_BOOST_THRESHOLD ? 'MAJOR_BOOST' as const : 'BOOST' as const;
}

const boostTotals = new Map<string, number>();
const acceptedAdminBoostNotifications = new Set<string>();
let boostObserverStarted = false;
let boostObserverRunning = false;
let boostBaselineReady = false;
let boostBaselinePromise: Promise<boolean> | null = null;
let boostObserverInterval: ReturnType<typeof setInterval> | null = null;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function shortAddress(value: string): string {
  const v = value.trim();
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v;
}

export function boostFallbackIdentity(tokenAddress: string, totalBoostAmount: number): string {
  return `${normalize(tokenAddress)}:${totalBoostAmount}`;
}

export function recordAcceptedAdminBoostNotification(tokenAddress: string, totalBoostAmount: number): void {
  acceptedAdminBoostNotifications.add(boostFallbackIdentity(tokenAddress, totalBoostAmount));
}

export async function deliverAdminBoostFallback(args: {
  tokenAddress: string;
  totalBoostAmount: number;
  message: string;
  buttons?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
}, dependencies: {
  send?: typeof sendTelegramWithMessageId;
  adminTelegramId?: string;
  log?: (event: string, details: Record<string, unknown>) => void;
} = {}): Promise<boolean> {
  const identity = boostFallbackIdentity(args.tokenAddress, args.totalBoostAmount);
  if (acceptedAdminBoostNotifications.has(identity)) return false;
  const log = dependencies.log ?? ((event, details) => console.log(`[RobinhoodBoostObserver] ${event}`, details));
  try {
    const result = await (dependencies.send ?? sendTelegramWithMessageId)(
      dependencies.adminTelegramId ?? config.adminTelegramId,
      args.message,
      args.buttons,
    );
    acceptedAdminBoostNotifications.add(identity);
    log('BOOST_FALLBACK_SENT', {
      token: normalize(args.tokenAddress),
      totalBoost: args.totalBoostAmount,
      messageId: (result as any)?.message_id ?? (result as any)?.messageId ?? null,
    });
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log('BOOST_FALLBACK_FAILED', {
      token: normalize(args.tokenAddress),
      totalBoost: args.totalBoostAmount,
      reason: reason.replace(/\s+/g, ' ').slice(0, 240),
    });
    return false;
  }
}

export function resetRobinhoodBoostFallbackForTests(): void {
  acceptedAdminBoostNotifications.clear();
}

/**
 * BOOST security is deliberately narrow. Market quality, liquidity, volume,
 * age, creator history and Supabase data are NOT eligibility gates here.
 *
 * SAFE    = contract bytecode was retrieved and no high-confidence malicious
 *           marker was found by this lightweight live check.
 * UNKNOWN = provider unavailable/inconclusive. This is not called SAFE, but
 *           infrastructure failure must not suppress a real Dex boost.
 * SCAM    = only explicit/high-confidence malicious evidence.
 */
type BoostSecurityDecision = {
  status: 'SAFE' | 'UNKNOWN' | 'SCAM';
  reason: string;
};

async function checkBoostContractSecurity(tokenAddress: string): Promise<BoostSecurityDecision> {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim();
  if (!rpcUrl) return { status: 'UNKNOWN', reason: 'security RPC not configured' };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getCode', params: [tokenAddress, 'latest'] }),
        signal: controller.signal,
      });
      if (!response.ok) return { status: 'UNKNOWN', reason: `security RPC HTTP ${response.status}` };
      const payload = await response.json() as { result?: string; error?: { message?: string } };
      if (payload.error) return { status: 'UNKNOWN', reason: payload.error.message ?? 'security RPC error' };
      const code = typeof payload.result === 'string' ? payload.result.toLowerCase() : '';
      if (!code || code === '0x') return { status: 'SCAM', reason: 'token address has no deployed contract code' };

      // High-confidence textual markers occasionally survive in Solidity/Vyper
      // metadata or embedded revert strings. Never use generic market-risk
      // signals here because BOOST is intentionally security-only.
      const ascii = Buffer.from(code.slice(2), 'hex').toString('latin1').toLowerCase();
      const explicitMarkers = ['honeypot', 'blacklisted', 'blacklist: blocked', 'trading disabled'];
      const marker = explicitMarkers.find(value => ascii.includes(value));
      if (marker) return { status: 'SCAM', reason: `malicious contract marker: ${marker}` };

      return { status: 'SAFE', reason: 'deployed contract code verified; no explicit malicious marker found' };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      status: 'UNKNOWN',
      reason: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  }
}

async function ensureBoostBaseline(): Promise<boolean> {
  if (boostBaselineReady) return true;
  if (boostBaselinePromise) return boostBaselinePromise;
  boostBaselinePromise = (async () => {
    try {
      const boosts = await fetchRobinhoodBoosts();
      // IMPORTANT: baseline is memory-only. Never query Supabase on startup.
      for (const boost of boosts) boostTotals.set(normalize(boost.tokenAddress), boost.totalAmount);
      boostBaselineReady = true;
      console.log('[RobinhoodBoostObserver] LIVE_ONLY_BASELINE_READY', { tokens: boosts.length, supabase: 'bypassed' });
      return true;
    } catch (error) {
      console.error('[RobinhoodBoostObserver] Baseline failed:', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      boostBaselinePromise = null;
    }
  })();
  return boostBaselinePromise;
}

export function buildBoostMessage(args: {
  symbol: string;
  name?: string | null;
  tokenAddress: string;
  boostAmount: number;
  totalBoostAmount: number;
  price?: number | null;
  marketCap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;
  volume5m?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
  age?: string | null;
  move?: number | null;
  momentum?: number | null;
  confidence?: number | null;
  risk?: string | null;
  rawData?: Record<string, unknown> | null;
  marketContext?: Record<string, unknown> | null;
  devHoldingPercent: number | null;
  burnedPercent?: number | null;
  holderTop1Percent: number | null;
  eventType: 'NEW' | 'INCREASE';
  securityStatus?: 'SAFE' | 'UNKNOWN' | 'SCAM';
  securityReason?: string;
}): string {
  const security = args.securityStatus ?? 'UNKNOWN';
  const securityLine = security === 'SAFE'
    ? '🛡️ Security: contract check passed'
    : security === 'UNKNOWN'
      ? '⚠️ Security: check incomplete — not classified as scam'
      : '⛔ Security: malicious contract evidence detected';
  return [
    `🚀 <b>DEX BOOST — ${args.eventType}</b>`,
    '',
    `<b>${args.symbol}</b>${args.name ? ` · ${args.name}` : ''}`,
    `Boost: +${args.boostAmount} · Total: ${args.totalBoostAmount}`,
    securityLine,
    args.securityReason ? `<i>${args.securityReason}</i>` : '',
    '',
    `<code>${args.tokenAddress}</code>`,
    '',
    'Boost is attention evidence, not a buy recommendation.',
  ].filter(Boolean).join('\n');
}

export function buildBoostActions(args: {
  tokenAddress: string;
  chartUrl?: string | null;
  opportunityId?: number | null;
  strategyKey?: string | null;
  rawData?: Record<string, unknown> | null;
}) {
  return [[
    { text: '🔎 Contract', url: `https://robinhoodchain.blockscout.com/token/${args.tokenAddress}` },
  ]];
}

// Kept for compatibility with existing imports/tests. Enrichment is disabled in
// live-only mode because post-send Supabase work must not compete with alerts.
export async function enrichDeliveredBoostAlert(): Promise<number> {
  return 0;
}

export function isMaterialVolumeSurge(args: {
  previousVolume5m: number | null;
  currentVolume5m: number | null;
  previousPrice: number | null;
  currentPrice: number | null;
}) {
  return args.previousVolume5m != null && args.previousVolume5m > 0 && args.currentVolume5m != null &&
    args.currentVolume5m >= args.previousVolume5m * 1.5 && args.previousPrice != null && args.previousPrice > 0 &&
    args.currentPrice != null && args.currentPrice >= args.previousPrice * 0.5;
}

export function volumeIgnitionDecision(args: {
  previousVolume5m: number | null;
  currentVolume5m: number | null;
  previousPrice: number | null;
  currentPrice: number | null;
  previousLiquidity?: number | null;
  currentLiquidity?: number | null;
  buys5m?: number | null;
  sells5m?: number | null;
}) {
  const multiple = args.previousVolume5m != null && args.previousVolume5m > 0 && args.currentVolume5m != null
    ? args.currentVolume5m / args.previousVolume5m : null;
  const priceConstructive = args.previousPrice != null && args.previousPrice > 0 && args.currentPrice != null &&
    args.currentPrice >= args.previousPrice * 0.5;
  const liquidityStable = args.previousLiquidity == null || args.currentLiquidity == null || args.previousLiquidity <= 0 ||
    args.currentLiquidity >= args.previousLiquidity * 0.85;
  const flowConstructive = args.buys5m == null || args.sells5m == null || args.buys5m >= args.sells5m;
  return {
    eligible: multiple != null && multiple >= 1.5 && priceConstructive && liquidityStable && flowConstructive,
    volumeMultiple: multiple,
  };
}

async function processBoost(boost: { tokenAddress: string; amount: number; totalAmount: number }): Promise<boolean> {
  const tokenKey = normalize(boost.tokenAddress);
  const previousTotal = boostTotals.get(tokenKey);
  if (previousTotal != null && boost.totalAmount <= previousTotal) return false;

  const eventType: 'NEW' | 'INCREASE' = previousTotal == null ? 'NEW' : 'INCREASE';
  const boostAdded = previousTotal == null ? boost.amount : Math.max(boost.totalAmount - previousTotal, 0);

  const security = await checkBoostContractSecurity(boost.tokenAddress);
  console.log('[RobinhoodBoostObserver] BOOST_SECURITY_DECISION', {
    token: tokenKey,
    status: security.status,
    reason: security.reason,
  });

  if (security.status === 'SCAM') {
    // Remember this total so the same known-bad boost does not hammer security
    // checks every 15 seconds. A future increase is checked again.
    boostTotals.set(tokenKey, boost.totalAmount);
    console.warn('[RobinhoodBoostObserver] BOOST_BLOCKED_SECURITY', {
      token: tokenKey,
      totalBoost: boost.totalAmount,
      reason: security.reason,
    });
    return false;
  }

  // Metadata is presentation-only and has a short deadline. Failure cannot
  // suppress the alert.
  const metadata = await resolveBoostMetadata(boost.tokenAddress, null, 500)
    .catch(() => boostMetadataFallback(boost.tokenAddress));
  const fallback = boostMetadataFallback(boost.tokenAddress);
  const symbol = metadata.symbol ?? fallback.symbol ?? shortAddress(boost.tokenAddress);

  const message = buildBoostMessage({
    symbol,
    name: metadata.name,
    tokenAddress: boost.tokenAddress,
    boostAmount: boostAdded,
    totalBoostAmount: boost.totalAmount,
    devHoldingPercent: null,
    holderTop1Percent: null,
    eventType,
    securityStatus: security.status,
    securityReason: security.reason,
  });

  const sent = await deliverAdminBoostFallback({
    tokenAddress: boost.tokenAddress,
    totalBoostAmount: boost.totalAmount,
    message,
    buttons: buildBoostActions({ tokenAddress: boost.tokenAddress }),
  });

  if (sent || acceptedAdminBoostNotifications.has(boostFallbackIdentity(boost.tokenAddress, boost.totalAmount))) {
    boostTotals.set(tokenKey, boost.totalAmount);
    console.log('[RobinhoodBoostObserver] BOOST_ALERT_VERIFIED', {
      token: tokenKey,
      eventType,
      boostAdded,
      totalBoost: boost.totalAmount,
      security: security.status,
      supabase: 'bypassed',
    });
    return true;
  }
  return false;
}

export async function runRobinhoodBoostObserverCycle(): Promise<void> {
  if (boostObserverRunning) return;
  boostObserverRunning = true;
  try {
    if (!await ensureBoostBaseline()) return;
    const boosts = await fetchRobinhoodBoosts();
    console.log('[RobinhoodBoostObserver] Feed:', { boosts: boosts.length, mode: 'LIVE_ONLY' });
    let alertsSent = 0;
    for (const boost of boosts) {
      try {
        if (await processBoost(boost)) alertsSent += 1;
      } catch (error) {
        console.error('[RobinhoodBoostObserver] Token processing failed:', {
          token: boost.tokenAddress,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[RobinhoodBoostObserver] Cycle complete:', { alertsSent, supabase: 'bypassed' });
  } catch (error) {
    console.error('[RobinhoodBoostObserver] Cycle failed:', error instanceof Error ? error.message : String(error));
  } finally {
    boostObserverRunning = false;
  }
}

export function startRobinhoodBoostObserver(): ReturnType<typeof setInterval> | null {
  if (boostObserverStarted) return boostObserverInterval;
  boostObserverStarted = true;
  console.log('[RobinhoodBoostObserver] Starting LIVE_ONLY security-only path...');
  void ensureBoostBaseline();
  boostObserverInterval = setInterval(() => void runRobinhoodBoostObserverCycle(), BOOST_INTERVAL_MS);
  return boostObserverInterval;
}
