import { POSITION_SIZES, type PositionCheck } from '../services/positionCheckService.js';
const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const eth = (v: string) => Number(v).toPrecision(6);
export function renderPositionCheck(check: PositionCheck): string {
  const q = check.quote;
  if (!q) return ['🎯 <b>POSITION CHECK</b>', '<b>Execution estimate unavailable</b>', '',
    esc(check.reason ?? 'Verified PONS pre-bond curve evidence is required.'),
    'This model supports verified PONS native-ETH pre-bond curves only. It does not estimate indexed DEX execution.', '',
    `<code>${esc(check.token)}</code>`, '<i>No estimate or trade placed</i>'].join('\n');
  return ['🎯 <b>POSITION CHECK · ROBINCHAIN</b>', `Selected budget  <b>${check.size} ETH</b>`,
    'Read-only analysis', '', '<b>CURVE MODEL ESTIMATE</b>',
    ...(q ? [
      `Estimated tokens  <b>${Number(q.tokens).toLocaleString('en-US', { maximumFractionDigits: 4 })}</b>`,
      `Estimated spend  <b>${eth(q.spentEth)} ETH</b>`,
      `Immediate sell after modeled buy  <b>${eth(q.recoveredEth)} ETH</b>`,
      `Buy fees + creator tax  <b>${eth(q.buyFeeEth)} ETH</b>`,
      `Sell fees + creator tax  <b>${eth(q.sellFeeEth)} ETH</b>`,
      `Buy price impact, excluding fees  <b>${q.priceImpactPct.toFixed(2)}%</b>`,
      `Modeled round-trip loss  <b>${q.roundTripLossPct.toFixed(2)}%</b>`,
      ...(q.partialFill ? ['⚠️ Partial allocation: modeled spend is below selected budget.'] : []),
      'One block snapshot · Assumes no intervening trades.',
      'Gas excluded · Execution and future slippage unverified.',
    ] : ['<b>Unable to assess execution</b>', esc(check.reason ?? 'No verified curve estimate available.')]), '',
    '<b>HOLDERS &amp; CREATOR</b>',
    ...(check.holders ? [
      `Sampled top 10  <b>${check.holders.top10.toFixed(2)}% of total supply</b>`,
      `Largest sampled holder  <b>${check.holders.largest.toFixed(2)}%</b>`,
      `${check.holders.sampled} sampled holders · ${check.holders.excluded} curve/pool/system/burn addresses excluded`,
      `Holder snapshot ${new Date(check.holders.at).toISOString().slice(11, 19)} UTC`,
      'Indexer sample; complete ownership and linked wallets unverified.',
    ] : ['Holder concentration  <b>Unable to assess</b>']),
    ...(check.creator ? [
      `Creator holding  <b>${check.creator.holding.toFixed(2)}%</b>`,
      check.creator.change == null ? 'Holding change  <b>No comparison baseline yet</b>'
        : `Change since ${check.creator.baselineKind === 'ALERT' ? 'setup alert' : 'first recorded check'}  <b>${check.creator.change >= 0 ? '+' : ''}${check.creator.change.toFixed(2)} percentage points</b>`,
      ...(check.creator.baselineAt != null ? [`Baseline ${new Date(check.creator.baselineAt).toISOString().slice(11, 19)} UTC`] : []),
      ...(check.creator.change != null && check.creator.change < 0 ? ['⚠️ Creator holding decreased; sale vs transfer not established.'] : []),
    ] : ['Creator holding / change  <b>Unable to assess</b>']),
    'Independent buyer demand  <b>Unable to assess</b>',
    check.setup ? `Setup low  <b>${check.setup.belowLow ? 'BROKEN — reconsider setup' : 'Not broken at this snapshot'}</b>` : 'Setup low comparison  <b>Unavailable</b>', '',
    `<code>${esc(check.token)}</code>`,
    `Checked ${new Date(check.checkedAt).toISOString().slice(11, 19)} UTC${check.block ? ` · Block ${esc(check.block)}` : ''}`,
    '<i>Research evidence · No investment approval or trade placed</i>',
  ].join('\n');
}
export function positionCheckButtons(token: string, supported = false) {
  return [...(supported ? [POSITION_SIZES.map(size => ({ text: `${size} ETH`, callback_data: `PC_RH_${size}_${token}` }))] : []),
    [{ text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }, { text: '📋 Copy CA', callback_data: `COPY_CA_${token}` }]];
}
