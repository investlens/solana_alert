import type { ChainMarketSnapshot } from '../shared/types.js';
import { readVolumeBreakoutResult, type VolumeBreakoutEvidence } from '../../services/volumeBreakoutEvidence.js';
import { getVerifiedRobinhoodLaunchpad } from './trustedLaunchpad.js';
import { routeBoostSecurity } from './boostSecurityRouter.js';
import { claimSharedDelivery } from '../../services/sharedJsonCache.js';
import { directTelegramRecipients } from './ponsNormalAlertFastLane.js';
import { recordFeedDelivery } from '../../services/feedDeliveryHealth.js';
let running = false;
console.log('[VolumeBreakout] READY chain=robinhood feed=RH_TRADE_SETUP completeDays=7 maxProviderRequestsPerMinute=6 dbCandleWrites=0');
const attempted = new Map<string, number>();
const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
export function volumeBreakoutCard(m: Pick<ChainMarketSnapshot, 'name' | 'symbol' | 'tokenAddress'>, e: VolumeBreakoutEvidence, risk: string): string {
  return ['📈 <b>TRADE SETUP · VOLUME BREAKOUT</b>', `<b>${html(m.name)} ($${html(m.symbol)})</b> · Robinchain`, '',
    '<b>MARKET</b>', `Price <b>$${e.price.toPrecision(6)}</b>`,
    `${e.marketCap ? 'Market cap' : 'FDV'} <b>${usd(e.marketCap ?? e.fdv!)}</b>`,
    `Liquidity <b>${usd(e.liquidity)}</b> · Pair age <b>${Math.floor((e.at - e.pairCreatedAt) / 86400000)}d</b>`,
    `Move · 1h <b>${e.move1h.toFixed(2)}%</b> · 24h <b>+${e.move24h.toFixed(2)}%</b>`, '',
    '<b>WHY ALERTED</b>', `24h pool volume <b>${usd(e.volume24h)}</b>`,
    `Previous 7 completed UTC days · daily average <b>${usd(e.dailyAverage)}</b>`,
    `Volume strength <b>${e.multiple.toFixed(2)}×</b>`, '',
    '<b>RISK</b>', html(risk), 'Unusual activity; wash trading and linked wallets are not ruled out.', '',
    `<code>${html(m.tokenAddress)}</code>`, `GeckoTerminal · Checked ${new Date(e.at).toISOString().slice(11,19)} UTC`,
    '<i>Research watch · Volume breakout is not a confirmed reversal · DYOR</i>'].join('\n');
}
// Piggybacks the existing older-token shortlist. No timers, candle writes or broad discovery.
export async function considerRobinhoodVolumeBreakout(m: ChainMarketSnapshot): Promise<void> {
  if (running || process.env.VOLUME_BREAKOUT_ENABLED === 'false') return;
  const now = Date.now(), token = m.tokenAddress.toLowerCase();
  if (!m.pairAddress || !m.name || !m.symbol || !m.pairCreatedAt || m.pairCreatedAt > (Math.floor(now / 86400000) - 7) * 86400000
    || (m.volume24hUsd ?? 0) < 10000 || now - (attempted.get(token) ?? 0) < 10 * 60000) return;
  for (const [k, at] of attempted) if (now - at > 3600000) attempted.delete(k);
  if (attempted.size >= 100) return;
  attempted.set(token, now);
  running = true;
  try {
  const result = await readVolumeBreakoutResult('robinhood', token, m.pairAddress);
  const evidence=result.evidence;
  recordFeedDelivery('RH_TRADE_SETUP', evidence ? 'EVALUATED' : result.reason==='CONDITION_WAIT'?'CONDITION_WAIT':'DATA_UNAVAILABLE');
  if (!evidence) { console.log(`[VolumeBreakout] WAIT reason=${result.reason} dbCandleWrites=0`); return; }
  const launch = await getVerifiedRobinhoodLaunchpad(token).catch(() => null);
  const gate = await routeBoostSecurity({ tokenAddress: token, verifiedTrustedLaunchpad: !!launch, requireExplicitSellability: true });
  if (!gate.allowed || Date.now() - evidence.at > 90000) return;
  const claim = await claimSharedDelivery(`alphaos:volume-breakout:delivered:robinhood:${token}`, 24 * 3600000);
  if (claim !== 'CLAIMED') return;
  const risk = launch ? `Verified ${launch.launchType} origin · market risks remain` : gate.reason;
  const delivery = await directTelegramRecipients(volumeBreakoutCard(m, evidence, risk), token, undefined, false, true,
    { chain: 'robinhood', token, feed: 'TRADE_SETUP_WATCH', price: evidence.price, marketCap: evidence.marketCap, liquidity: evidence.liquidity, pair: m.pairAddress, creator: launch?.deployer, unit: 'USD' },
    { skipKeyStats: true });
  console.log(`[VolumeBreakout] SENT delivered=${delivery.delivered} failed=${delivery.failed} multiplier=${evidence.multiple.toFixed(2)} dbCandleWrites=0`);
  } finally { running = false; }
}
