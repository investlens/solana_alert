import type { TokenIntel } from '../services/tokenIntelligenceService.js';

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (value: number | null) => value == null ? 'UNKNOWN' : value === 0 ? '$0' : value >= 1_000_000
  ? `$${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}K` : `$${value.toPrecision(4)}`;
const pct = (value: number | null) => value == null ? 'UNKNOWN' : `${value.toFixed(1)}%`;
const short = (value: string | null) => value ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'UNKNOWN';
export function formatIntelTime(value: string | null, now = Date.now()): string {
  if (!value) return 'time unavailable';
  const timestamp = Date.parse(value); if (!Number.isFinite(timestamp)) return 'time unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 45) return 'just now'; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${new Date(timestamp).toISOString().slice(11, 16)} UTC`;
}
const sourceName = (value: string | null) => !value ? null : /DEXSCREENER/i.test(value) ? 'DexScreener' : 'AlphaOS verified history';
const alphaView = (state: string | null) => ({ FORMING: 'Early activity forming.', BUILDING: 'Momentum is building.',
  CONFIRMED: 'Opportunity structure confirmed.', RUNNER: 'Momentum remains strong.', COOLING: 'Momentum is cooling.' }[String(state ?? '').toUpperCase()] ?? null);
const technicalDiagnostic = (value: string) => /\bHTTP\s*\d{3}\b|provider unavailable|lookup unavailable|analysis deadline|request failed/i.test(value);

export function normalizedTokenSupply(raw: string | null, decimals: number | null): string | null {
  if (!raw || decimals == null || !Number.isInteger(decimals) || decimals < 0 || !/^\d+$/.test(raw)) return null;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = decimals ? padded.slice(0, -decimals) : padded;
  const fraction = decimals ? padded.slice(-decimals).replace(/0+$/, '').slice(0, 6) : '';
  const grouped = BigInt(whole || '0').toLocaleString('en-US');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function renderTokenIntelligence(intel: TokenIntel): string {
  const athDistance = intel.ath.distanceFromMarketCapPct == null ? 'UNKNOWN'
    : intel.ath.distanceFromMarketCapPct <= 0 ? `${Math.abs(intel.ath.distanceFromMarketCapPct).toFixed(1)}% below observed peak`
      : `${intel.ath.distanceFromMarketCapPct.toFixed(1)}% above prior observed peak`;
  const currentMarketAvailable = intel.price != null || intel.marketCap != null || intel.liquidity != null || intel.volume5m != null;
  const holdersAvailable = intel.holders.count != null || intel.holders.top10Pct != null || intel.holders.largestPct != null;
  const freshAvailable = intel.freshWallets.evidence === 'VERIFIED';
  const supply = normalizedTokenSupply(intel.supply, intel.decimals);
  const developerAvailable = intel.developer.wallet != null || intel.developer.holdingPct != null || intel.developer.sold != null || intel.developer.transferredPct != null || intel.developer.burnedPct != null;
  const securityAvailable = intel.security.tokenBurnedPct != null || intel.security.lpStatus !== 'UNKNOWN' || intel.security.dexPaid != null || intel.security.boostTotal != null;
  const historyAvailable = intel.devHistory.launches > 0;
  const view = alphaView(intel.alpha.state);
  const watch = intel.alpha.watch.filter(item => !technicalDiagnostic(item)).slice(0, 4);
  const lines = [
    '🔬 <b>FULL INTEL</b>', '',
    `<b>${esc(intel.name ?? 'Unknown Token')} (${esc(intel.symbol ? `$${intel.symbol}` : 'UNKNOWN')})</b>`,
    `<code>${esc(short(intel.tokenAddress))}</code>`, '',
    '📊 <b>MARKET</b>', ...(currentMarketAvailable ? [
      ...(intel.price != null ? [`Price             <b>${money(intel.price)}</b>`] : []),
      ...(intel.marketCap != null ? [`Market Cap        <b>${money(intel.marketCap)}</b>`] : []),
      ...(intel.liquidity != null ? [`Liquidity         <b>${money(intel.liquidity)}</b>`] : []),
      ...(intel.volume5m != null ? [`Volume (5m)       <b>${money(intel.volume5m)}</b>`] : []),
      ...(intel.volume24h != null ? [`Volume (24h)      <b>${money(intel.volume24h)}</b>`] : []),
      ...(intel.priceChange1h != null ? [`Move (1h)         <b>${intel.priceChange1h >= 0 ? '+' : ''}${intel.priceChange1h.toFixed(2)}%</b>`] : []),
      ...(intel.ageObservedAt ? [`Pair observed     <b>${formatIntelTime(intel.ageObservedAt)}</b>`] : []),
      `Observed          <b>${formatIntelTime(intel.marketObservedAt ?? intel.analyzedAt)}</b>`,
    ] : [
      'Current market data <b>unavailable</b>',
      ...(intel.lastVerifiedMarket?.price != null ? [`Last verified price <b>${money(intel.lastVerifiedMarket.price)}</b>`] : []),
      ...(intel.lastVerifiedMarket?.marketCap != null ? [`Last verified MC    <b>${money(intel.lastVerifiedMarket.marketCap)}</b>`] : []),
      ...(intel.lastVerifiedMarket?.liquidity != null ? [`Last verified liq   <b>${money(intel.lastVerifiedMarket.liquidity)}</b>`] : []),
      ...(intel.lastVerifiedMarket?.volume5m != null ? [`Last verified vol 5m <b>${money(intel.lastVerifiedMarket.volume5m)}</b>`] : []),
      ...(intel.lastVerifiedMarket?.observedAt ? [`Last observed       <b>${formatIntelTime(intel.lastVerifiedMarket.observedAt)}</b>`] : []),
    ]),
    ...(intel.fdv != null && intel.marketCap == null ? [`FDV               <b>${money(intel.fdv)}</b>`, `Valuation source  ${esc(intel.valuationSource ?? 'Unavailable')}`] : []),
    ...(intel.ath.priceUsd != null || intel.ath.marketCapUsd != null ? [
      ...(intel.ath.distanceFromMarketCapPct != null ? [`From observed peak <b>${esc(athDistance)}</b>`] : []),
      ...(intel.ath.priceUsd != null ? [`Observed peak price <b>${money(intel.ath.priceUsd)}</b>`] : []),
      ...(intel.ath.marketCapUsd != null ? [`Observed peak MC   <b>${money(intel.ath.marketCapUsd)}</b>`] : []),
      ...(sourceName(intel.ath.priceSource ?? intel.ath.marketCapSource) ? [`Peak source        <b>${sourceName(intel.ath.priceSource ?? intel.ath.marketCapSource)}</b>`] : []),
      ...(intel.ath.priceObservedAt || intel.ath.marketCapObservedAt ? [`Peak observed      <b>${formatIntelTime(intel.ath.priceObservedAt ?? intel.ath.marketCapObservedAt)}</b>`] : []),
      '<i>Highest verified AlphaOS observation; full lifetime ATH is not established.</i>',
    ] : ['Lifetime ATH not established.']),
    ...(supply ? [`Supply            <b>${esc(supply)}</b>`] : []), '',
    ...(!holdersAvailable && !freshAvailable ? ['👥 <b>HOLDERS &amp; FRESH WALLETS</b>', 'Analysis currently unavailable.',
      'Not used for opportunity filtering.'] : []),
    ...(holdersAvailable ? ['👥 <b>HOLDERS</b>',
      ...(intel.holders.count != null ? [`Observed holders  <b>${intel.holders.count}</b>`] : []),
      ...(intel.holders.top10Pct != null ? [`Top 10            <b>${pct(intel.holders.top10Pct)}</b>`] : []),
      ...(intel.holders.largestPct != null ? [`Largest holder    <b>${pct(intel.holders.largestPct)}</b>`] : []),
      'Indexed sample; percentages use total supply, with known pool/burn/factory addresses excluded.',
      ...(intel.holders.risk !== 'UNKNOWN' ? [`Concentration     <b>${esc(intel.holders.risk)}</b>`] : [])] : []),
    ...(freshAvailable ? ['🆕 <b>FRESH WALLETS</b>',
      `1D verified fresh <b>${pct(intel.freshWallets.oneDayPct)}</b>`,
      `Coverage          <b>${intel.freshWallets.classified} / ${intel.freshWallets.sampleSize}</b> (${pct(intel.freshWallets.coveragePct)})`,
    ] : holdersAvailable ? ['🆕 <b>FRESH WALLETS</b>', 'Analysis currently unavailable.', 'Not used for opportunity filtering.'] : []),
    ...(freshAvailable && intel.freshWallets.oneDayPct != null && intel.freshWallets.oneDayPct > 50
      ? ['⚠️ <b>High fresh-wallet concentration</b>',
        `${intel.freshWallets.oneDayPct.toFixed(1)}% of verified classified wallets are ≤1 day old`] : []),
    '', ...(!developerAvailable && !historyAvailable ? ['👨‍💻 <b>DEVELOPER</b>', 'No verified developer history available.'] : []),
    ...(developerAvailable ? ['👨‍💻 <b>DEVELOPER</b>',
      ...(intel.developer.wallet ? [`Wallet             <code>${esc(short(intel.developer.wallet))}</code>`] : []),
      ...(intel.developer.holdingPct != null ? [`Holding            <b>${pct(intel.developer.holdingPct)}</b>`] : []),
      ...(intel.developer.sold != null ? [`Sold               <b>${intel.developer.sold ? 'Verified sell' : 'No verified sell'}</b>`] : []),
      ...(intel.developer.transferredPct != null ? [`Transferred        <b>${pct(intel.developer.transferredPct)}</b>`] : []),
      ...(intel.developer.burnedPct != null ? [`Burned             <b>${pct(intel.developer.burnedPct)}</b>`] : []),
      ...(intel.developer.holdingPct != null ? [`Holding observed   ${formatIntelTime(intel.developer.holdingObservedAt ?? intel.developer.observedAt ?? null)}`] : []),
      ...(intel.developer.sold != null || intel.developer.transferredPct != null || intel.developer.burnedPct != null ? [
        `Flow snapshot      ${formatIntelTime(intel.developer.observedAt ?? null)}`,
        'Transfers are not confirmed sales. Flow history is incomplete.',
      ] : ['Creator selling not assessed.']),
    ] : []),
    ...(historyAvailable ? ['📜 <b>DEV HISTORY</b>',
      `Observed launches  <b>${intel.devHistory.launches}</b>`, `Measured success  <b>${intel.devHistory.measuredSuccessful}</b>`,
      `Weak/failed        <b>${intel.devHistory.weakOrFailed}</b>`, `Verdict            <b>${esc(intel.devHistory.verdict)}</b>`,
    ] : []), '',
    '🔥 <b>TOKEN / SECURITY</b>', ...(securityAvailable ? [
      ...(intel.security.tokenBurnedPct != null ? [`Token burned      <b>${pct(intel.security.tokenBurnedPct)}</b>`] : []),
      ...(intel.security.lpStatus !== 'UNKNOWN' ? [`LP status         <b>${intel.security.lpStatus}</b>`] : []),
      ...(intel.security.dexPaid != null ? [`DEX Paid          <b>${intel.security.dexPaid ? 'YES' : 'NO'}</b>`] : []),
      ...(intel.security.boostTotal != null ? [`Boost total       <b>${intel.security.boostTotal}</b>`] : []),
    ] : ['No verified token-security data available.']),
    'Sellability and contract controls are not established by this report. DEX payment is promotion evidence.',
    '24h fees unavailable from current sources.', '',
    '🧠 <b>ALPHAOS</b>', `State              <b>${esc(intel.alpha.state ?? 'UNKNOWN')}</b>`,
    `Risk               ${esc(intel.alpha.risk === 'MEASURED' ? 'UNKNOWN' : intel.alpha.risk ?? 'UNKNOWN')}`,
    ...intel.alpha.positive.slice(0, 3).map(x => `✅ ${esc(x)}`), ...watch.map(x => `⚠️ ${esc(x)}`),
    ...(view ? [`View               ${esc(view)}`] : []), '',
    `<i>Observed ${formatIntelTime(intel.analyzedAt)}</i>`,
  ];
  const rendered = lines.join('\n');
  if (rendered.length > 3000) throw new Error('Full Intel exceeds compact Telegram budget');
  return rendered;
}

export function tokenIntelligenceButtons(intel: TokenIntel, supportedCurve = false) {
  const rows: Array<Array<{ text: string; url: string } | { text: string; callback_data: string }>> = [];
  const market = [] as Array<{ text: string; url: string }>;
  if (intel.chartUrl) market.push({ text: '📊 Chart', url: intel.chartUrl });
  market.push({ text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${intel.tokenAddress}` });
  rows.push(market);
  if (/^0x[a-fA-F0-9]{40}$/.test(intel.tokenAddress)) rows.push([...(supportedCurve ? [{ text: '🎯 Curve Estimate', callback_data: `PC_RH_0.01_${intel.tokenAddress}` }] : []), { text: '📋 Copy CA', callback_data: `COPY_CA_${intel.tokenAddress}` }]);
  rows.push([{text:'🧬 Supply Journey',callback_data:`SJ_RH_${intel.tokenAddress}`},{text:'🔗 Wallet Links · Pro',callback_data:`WL_RH_${intel.tokenAddress}`}]);
  rows.push([{ text: '🎯 Readiness · Pro', callback_data: `TR_RH_${intel.tokenAddress}` }, { text: 'My Monitors', callback_data: 'DM_HOME' }]);
  return rows;
}
