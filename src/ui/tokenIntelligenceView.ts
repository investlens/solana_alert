import type { TokenIntel } from '../services/tokenIntelligenceService.js';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: number | null) => value == null ? 'UNKNOWN' : value >= 1_000_000
  ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${value.toPrecision(4)}`;
const pct = (value: number | null) => value == null ? 'UNKNOWN' : `${value.toFixed(1)}%`;
const short = (value: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'UNKNOWN';

export function renderTokenIntelligence(intel: TokenIntel): string {
  const age = intel.ageObservedAt ? new Date(intel.ageObservedAt).toISOString().slice(0, 10) : 'UNKNOWN';
  const athDistance = intel.ath.distanceFromMarketCapPct == null ? 'UNKNOWN'
    : intel.ath.distanceFromMarketCapPct <= 0 ? `${Math.abs(intel.ath.distanceFromMarketCapPct).toFixed(1)}% below ATH`
      : `${intel.ath.distanceFromMarketCapPct.toFixed(1)}% above prior observed ATH`;
  const lines = [
    '🔬 <b>TOKEN INTELLIGENCE</b>', '',
    `🪙 <b>${esc(intel.name ?? 'Unknown Token')} (${esc(intel.symbol ? `$${intel.symbol}` : 'UNKNOWN')})</b>`,
    `<code>${esc(short(intel.tokenAddress))}</code>`, `Verified pair observed: <b>${age}</b>`, '',
    '📊 <b>MARKET</b>', `Price             <b>${money(intel.price)}</b>`,
    `Market Cap        <b>${money(intel.marketCap)}</b>`, `Liquidity         <b>${money(intel.liquidity)}</b>`,
    `Volume (5m)       <b>${money(intel.volume5m)}</b>`,
    `ATH Market Cap    <b>${money(intel.ath.marketCapUsd)}</b>`,
    `ATH MC observed   <b>${esc(intel.ath.marketCapObservedAt ?? 'UNKNOWN')}</b>`,
    `ATH MC source     <b>${esc(intel.ath.marketCapSource ?? 'UNKNOWN')}</b>`,
    `ATH Price         <b>${money(intel.ath.priceUsd)}</b>`,
    `ATH Price observed <b>${esc(intel.ath.priceObservedAt ?? 'UNKNOWN')}</b>`,
    `ATH Price source  <b>${esc(intel.ath.priceSource ?? 'UNKNOWN')}</b>`,
    `Distance from ATH <b>${esc(athDistance)}</b>`,
    `Supply            <b>${esc(intel.supply ?? 'UNKNOWN')}</b>`, '',
    '👥 <b>HOLDERS</b>', `Observed holders  <b>${esc(intel.holders.count ?? 'UNKNOWN')}</b>`,
    `Top 10            <b>${pct(intel.holders.top10Pct)}</b>`, `Largest holder    <b>${pct(intel.holders.largestPct)}</b>`,
    `Concentration     <b>${esc(intel.holders.risk)}</b>`, '',
    '🆕 <b>FRESH WALLETS</b>', `1D verified fresh <b>${pct(intel.freshWallets.oneDayPct)}</b>`,
    `Coverage          <b>${intel.freshWallets.classified} / ${intel.freshWallets.sampleSize} wallets</b> (${pct(intel.freshWallets.coveragePct)})`,
    `Confidence        <b>${intel.freshWallets.evidence}</b>`,
    ...(intel.freshWallets.evidence === 'VERIFIED' && intel.freshWallets.oneDayPct != null && intel.freshWallets.oneDayPct > 50
      ? ['⚠️ <b>High fresh-wallet concentration</b>',
        `${intel.freshWallets.oneDayPct.toFixed(1)}% of verified classified wallets are ≤1 day old`] : []),
    ...(intel.freshWallets.evidence === 'VERIFIED' ? [] : ['Not used for opportunity filtering.']), '',
    '👨‍💻 <b>DEVELOPER</b>', `Dev wallet         <code>${esc(short(intel.developer.wallet))}</code>`,
    `Current holding   <b>${pct(intel.developer.holdingPct)}</b>`,
    `Verified sold     <b>${intel.developer.sold == null ? 'UNKNOWN' : intel.developer.sold ? 'YES' : 'NO'}</b>`,
    `Transferred       <b>${pct(intel.developer.transferredPct)}</b>`, `Token burned      <b>${pct(intel.developer.burnedPct)}</b>`, '',
    '📜 <b>DEV HISTORY</b>', `Observed launches  <b>${intel.devHistory.launches || 'UNKNOWN'}</b>`,
    `Measured success  <b>${intel.devHistory.measuredSuccessful}</b>`, `Weak/failed        <b>${intel.devHistory.weakOrFailed}</b>`,
    `Verdict           <b>${esc(intel.devHistory.verdict)}</b>`, '',
    '🔥 <b>TOKEN / SECURITY</b>', `Token burned      <b>${pct(intel.security.tokenBurnedPct)}</b>`,
    `LP status         <b>${intel.security.lpStatus}</b>`, `DEX Paid          <b>${intel.security.dexPaid == null ? 'UNKNOWN' : intel.security.dexPaid ? 'YES' : 'NO'}</b>`,
    `Boost total       <b>${intel.security.boostTotal ?? 'UNKNOWN'}</b>`, '',
    '🧠 <b>ALPHAOS VIEW</b>', `Current state      <b>${esc(intel.alpha.state ?? 'UNKNOWN')}</b>`,
    `Current risk       <b>${esc(intel.alpha.risk ?? 'UNKNOWN')}</b>`,
    ...intel.alpha.positive.slice(0, 3).map(x => `✅ ${esc(x)}`), ...intel.alpha.watch.slice(0, 4).map(x => `⚠️ ${esc(x)}`),
    `Verdict: <b>${esc(intel.alpha.verdict)}</b>`, '',
    ...(intel.incompleteReason ? ['', `<i>${esc(intel.incompleteReason)}</i>`] : []),
    `<i>Observed ${esc(intel.analyzedAt)} · ${esc(intel.status)}</i>`,
  ];
  return lines.join('\n').slice(0, 3900);
}

export function tokenIntelligenceButtons(intel: TokenIntel) {
  const rows: Array<Array<{ text: string; url: string }>> = [];
  const market = [] as Array<{ text: string; url: string }>;
  if (intel.chartUrl) market.push({ text: '📊 Chart', url: intel.chartUrl });
  market.push({ text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${intel.tokenAddress}` });
  rows.push(market);
  const socials = intel.socials.map(x => ({ text: x.label === 'X' ? '𝕏 X' : x.label === 'Telegram' ? '✈️ Telegram' : '🌐 Website', url: x.url }));
  if (socials.length) rows.push(socials);
  return rows;
}
