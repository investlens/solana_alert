import type { ChainMarketSnapshot } from '../shared/types.js';
import { readVolumeBreakoutResult, type VolumeBreakoutEvidence } from '../../services/volumeBreakoutEvidence.js';
import { getVerifiedRobinhoodLaunchpad } from './trustedLaunchpad.js';
import { routeBoostSecurity } from './boostSecurityRouter.js';
import { claimSharedDelivery } from '../../services/sharedJsonCache.js';
import { directTelegramRecipients } from './ponsNormalAlertFastLane.js';
import { recordFeedDelivery } from '../../services/feedDeliveryHealth.js';
let running = false;
console.log('[VolumeBreakout] READY chain=robinhood feed=RH_TRADE_SETUP completeDays=8 maxProviderRequestsPerMinute=6 dbCandleWrites=0');
const queued = new Map<string, ChainMarketSnapshot>();
const MAX_QUEUED = 6;
const attempted = new Map<string, number>();
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
export function volumeBreakoutCard(m: Pick<ChainMarketSnapshot, 'name' | 'symbol' | 'tokenAddress'>, e: VolumeBreakoutEvidence, risk: string): string {
  return ['📈 <b>TRADE SETUP · VOLUME SURGE WATCH</b>', `<b>${html(m.name)} ($${html(m.symbol)})</b> · Robinchain`, '',
    '<b>CURRENT MARKET</b>', `Market cap <b>${e.marketCap ? usd(e.marketCap) : 'Unavailable'}</b>`,
    ...(!e.marketCap && e.fdv ? [`FDV <b>${usd(e.fdv)}</b>`] : []),
    `Price <b>$${e.price.toPrecision(6)}</b>`,
    `Liquidity <b>${usd(e.liquidity)}</b> · Pair age <b>${Math.floor((e.at - e.pairCreatedAt) / 86400000)}d</b>`,
    ...(e.move1h != null ? [`Move · 1h <b>${e.move1h.toFixed(2)}%</b>`] : []),
    ...(e.move24h != null ? [`Move · rolling 24h <b>${e.move24h.toFixed(2)}%</b>`] : []), '',
    '<b>WHY ALERTED</b>', `Completed day pool volume <b>${usd(e.signalVolume)}</b>`,
    `Signal day <b>${new Date(e.dayStart).toISOString().slice(0,10)} UTC</b> · Price <b>+${e.signalMove.toFixed(2)}%</b>`,
    `Preceding 7 days · daily average <b>${usd(e.dailyAverage)}</b>`,
    `Volume strength <b>${e.multiple.toFixed(2)}×</b>`, '',
    '<b>RISK</b>', html(risk), 'Unusual activity; wash trading and linked wallets are not ruled out.', '',
    `<code>${html(m.tokenAddress)}</code>`, `Market: ${e.marketSource ?? 'GeckoTerminal'} · History: GeckoTerminal · Checked ${new Date(e.at).toISOString().slice(11,19)} UTC`,
    '<i>Research watch · Activity signal, not a buy recommendation · DYOR</i>'].join('\n');
}
// Piggybacks the existing older-token shortlist. No timers, candle writes or broad discovery.
export async function considerRobinhoodVolumeBreakout(m: ChainMarketSnapshot, read = readVolumeBreakoutResult): Promise<void> {
  if ( process.env.VOLUME_BREAKOUT_ENABLED === 'false') return;
  const now = Date.now(), token = m.tokenAddress.toLowerCase();
  if (!m.pairAddress || !m.name || !m.symbol || !m.pairCreatedAt || m.pairCreatedAt > (Math.floor(now / 86400000) - 8) * 86400000
    || now - (attempted.get(token) ?? 0) < 10 * 60000) return;
  for (const [k, at] of attempted) if (now - at > 3600000) attempted.delete(k);
  if (attempted.size >= 100) return;
  if (queued.size >= MAX_QUEUED && !queued.has(token)) return;
  queued.set(token, m);
  if (running) return;
  running = true;
  try {
    while (queued.size) {
      const [token, m] = queued.entries().next().value!;
      queued.delete(token);
      // A queued lookup may outlive the market observation or become redundant.
      if (Date.now() - m.timestamp > 90_000 || Date.now() - (attempted.get(token) ?? 0) < 10 * 60000) continue;
      const result = await read('robinhood', token, m.pairAddress!, m);
      // Capacity/backoff is not a completed evaluation. Let the next ordinary
      // scanner observation retry rather than suppressing it for ten minutes.
      if (!['CAPACITY_LIMITED', 'PROVIDER_BACKOFF', 'PROVIDER_UNAVAILABLE'].includes(result.reason)) attempted.set(token, Date.now());
    const evidence=result.evidence;
    recordFeedDelivery('RH_TRADE_SETUP', evidence ? 'EVALUATED' : result.reason==='CONDITION_WAIT'?'CONDITION_WAIT':'DATA_UNAVAILABLE');
    if (!evidence) { console.log(`[VolumeBreakout] WAIT token=${token} reason=${result.reason} dbCandleWrites=0`); continue; }
    const launch = await getVerifiedRobinhoodLaunchpad(token).catch(() => null);
    const gate = await routeBoostSecurity({ tokenAddress: token, verifiedTrustedLaunchpad: !!launch, requireExplicitSellability: true });
    if (!gate.allowed || Date.now() - evidence.at > 90000) continue;
    const claim = await claimSharedDelivery(`alphaos:volume-breakout:delivered:robinhood:${token}:${evidence.dayStart}`, 24 * 3600000);
    if (claim !== 'CLAIMED') continue;
    const risk = launch ? `Verified ${launch.launchType} origin · market risks remain` : gate.reason;
    const delivery = await directTelegramRecipients(volumeBreakoutCard(m, evidence, risk), token, undefined, false, true,
      { chain: 'robinhood', token, feed: 'TRADE_SETUP_WATCH', price: evidence.price, marketCap: evidence.marketCap, liquidity: evidence.liquidity, pair: m.pairAddress!, creator: launch?.deployer, unit: 'USD' },
      { skipKeyStats: true });
    console.log(`[VolumeBreakout] SENT delivered=${delivery.delivered} failed=${delivery.failed} multiplier=${evidence.multiple.toFixed(2)} dbCandleWrites=0`);
    }
  } finally { running = false; }
}

export function resetVolumeBreakoutQueueForTests() { queued.clear(); attempted.clear(); running = false; }
