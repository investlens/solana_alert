import type { TokenIntel } from '../services/tokenIntelligenceService.js';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: number | null) => value == null ? 'VERIFYING' : value === 0 ? '$0' : value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : value >= 1 ? `$${value.toFixed(4)}` : `$${value.toPrecision(4)}`;
const pct = (value: number | null) => value == null ? 'VERIFYING' : `${value.toFixed(1)}%`;
const short = (value: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'VERIFYING';
export function formatIntelTime(value: string | null, now = Date.now()): string { if (!value) return 'unavailable'; const t = Date.parse(value); if (!Number.isFinite(t)) return 'unavailable'; const s = Math.max(0, Math.floor((now - t) / 1000)); if (s < 45) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; }
const sourceName = (value: string | null) => !value ? null : /DEXSCREENER/i.test(value) ? 'DexScreener' : 'AlphaOS verified history';
const technicalDiagnostic = (value: string) => /\bHTTP\s*\d{3}\b|provider unavailable|lookup unavailable|analysis deadline|request failed/i.test(value);

export function normalizedTokenSupply(raw: string | null, decimals: number | null): string | null { if (!raw || decimals == null || !Number.isInteger(decimals) || decimals < 0 || !/^\d+$/.test(raw)) return null; const padded = raw.padStart(decimals + 1, '0'); const whole = decimals ? padded.slice(0, -decimals) : padded; const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '').slice(0, 6) : ''; const grouped = BigInt(whole || '0').toLocaleString('en-US'); return fraction ? `${grouped}.${fraction}` : grouped; }

export function renderTokenIntelligence(intel: TokenIntel): string {
  const supply = normalizedTokenSupply(intel.supply, intel.decimals);
  const athDistance = intel.ath.distanceFromMarketCapPct == null ? 'VERIFYING' : intel.ath.distanceFromMarketCapPct <= 0 ? `-${Math.abs(intel.ath.distanceFromMarketCapPct).toFixed(1)}%` : `+${intel.ath.distanceFromMarketCapPct.toFixed(1)}%`;
  const fresh = intel.freshWallets.evidence === 'VERIFIED';
  const watch = intel.alpha.watch.filter(x => !technicalDiagnostic(x)).slice(0, 3);
  const socialLabels = intel.socials.map(s => s.label).join(' · ');
  const security = [intel.security.dexPaid === true ? 'DEX PAID' : null, intel.security.lpStatus !== 'UNKNOWN' ? `LP ${intel.security.lpStatus}` : null, intel.security.tokenBurnedPct != null ? `BURN ${intel.security.tokenBurnedPct.toFixed(1)}%` : null, intel.security.boostTotal != null ? `BOOST ${intel.security.boostTotal}` : null].filter(Boolean).join(' · ');
  const lines = [
    '🔬 <b>ALPHAOS FULL INTEL</b>',
    `<b>${esc(intel.name ?? 'Unknown Token')}</b> ${intel.symbol ? `($${esc(intel.symbol)})` : ''}`,
    'ROBINHOOD · PONS',
    `<code>${esc(intel.tokenAddress)}</code>`, '',
    '📊 <b>STATS</b>',
    `USD       <b>${money(intel.price)}</b>`,
    `MC        <b>${money(intel.marketCap)}</b>`,
    `Vol 5m    <b>${money(intel.volume5m)}</b>`,
    `LP        <b>${money(intel.liquidity)}</b>`,
    `Supply    <b>${esc(supply ?? 'VERIFYING')}</b>`,
    `ATH MC    <b>${money(intel.ath.marketCapUsd)}</b> (${athDistance})`,
    ...(intel.ath.priceUsd != null ? [`ATH Price <b>${money(intel.ath.priceUsd)}</b>`] : []),
    `Age       <b>${formatIntelTime(intel.ageObservedAt)}</b>`, '',
    '🔗 <b>SOCIALS</b>', socialLabels ? esc(socialLabels) : 'No verified project socials found.', '',
    '🛡 <b>SECURITY</b>',
    `Fresh 1D  <b>${fresh ? pct(intel.freshWallets.oneDayPct) : 'VERIFYING'}</b>`,
    `Top 10    <b>${pct(intel.holders.top10Pct)}</b>${intel.holders.count != null ? ` | ${intel.holders.count} holders` : ''}`,
    `Top 1     <b>${pct(intel.holders.largestPct)}</b>`,
    `Bundle    <b>${esc(intel.holders.risk === 'UNKNOWN' ? 'VERIFYING' : intel.holders.risk)}</b>`,
    `DEX Paid  <b>${intel.security.dexPaid == null ? 'VERIFYING' : intel.security.dexPaid ? 'YES' : 'NO'}</b>`,
    ...(security ? [`Structure <b>${esc(security)}</b>`] : []), '',
    '👨‍💻 <b>DEVELOPER</b>',
    `Wallet    <code>${esc(short(intel.developer.wallet))}</code>`,
    `Holding   <b>${pct(intel.developer.holdingPct)}</b>`,
    `Sold      <b>${intel.developer.sold == null ? 'VERIFYING' : intel.developer.sold ? 'YES ⚠️' : 'NO'}</b>`,
    `Moved     <b>${pct(intel.developer.transferredPct)}</b>`,
    `Burned    <b>${pct(intel.developer.burnedPct)}</b>`,
    `Launches  <b>${intel.devHistory.launches || 'VERIFYING'}</b>`,
    ...(intel.devHistory.launches ? [`History   <b>${intel.devHistory.measuredSuccessful} measured wins · ${intel.devHistory.weakOrFailed} weak/failed</b>`, `Verdict   <b>${esc(intel.devHistory.verdict)}</b>`] : []), '',
    '🧠 <b>ALPHAOS</b>',
    `State     <b>${esc(intel.alpha.state ?? 'VERIFYING')}</b>`,
    `Risk      <b>${esc(intel.alpha.risk === 'MEASURED' ? 'VERIFYING' : intel.alpha.risk ?? 'VERIFYING')}</b>`,
    ...intel.alpha.positive.slice(0, 3).map(x => `✅ ${esc(x)}`),
    ...watch.map(x => `⚠️ ${esc(x)}`), '',
    `<i>Intelligence refreshed ${formatIntelTime(intel.analyzedAt)}</i>`,
  ];
  const rendered = lines.join('\n'); if (rendered.length > 3200) throw new Error('Full Intel exceeds compact Telegram budget'); return rendered;
}

const webBase = () => (process.env.ALPHAOS_WEB_URL ?? 'https://alphaos-web-preview-production.up.railway.app').replace(/\/+$/, '');
export function tokenIntelligenceButtons(intel: TokenIntel) {
  const rows: Array<Array<{ text: string; url: string } | { text: string; callback_data: string }>> = [];
  rows.push([{ text: '🧠 Open AlphaOS', url: `${webBase()}/intelligence/${encodeURIComponent(intel.tokenAddress)}` }]);
  const market: Array<{ text: string; url: string }> = [];
  if (intel.chartUrl) market.push({ text: '📊 Chart', url: intel.chartUrl });
  market.push({ text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${intel.tokenAddress}` }); rows.push(market);
  const socials = intel.socials.map(s => ({ text: s.label === 'X' ? '𝕏 X' : s.label === 'Telegram' ? '✈️ TG' : '🌐 Web', url: s.url })); if (socials.length) rows.push(socials.slice(0, 3));
  if (/^0x[a-fA-F0-9]{40}$/.test(intel.tokenAddress)) rows.push([{ text: '📋 Copy CA', callback_data: `COPY_CA_${intel.tokenAddress}` }]);
  return rows;
}
