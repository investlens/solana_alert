import { renderAlphaNotification, type AlphaNotificationState } from './alphaNotification.js';
import { formatUsd } from './alphaAlert/index.js';
import type { CoreDecisionMetricContext, NotificationMarketContext } from './notificationMarketContext.js';

type PremiumState = Extract<AlphaNotificationState, 'OPPORTUNITY' | 'VOLUME_IGNITION' | 'DEX_PAID' | 'BOOST' | 'MAJOR_BOOST' | 'DEV_BURN' | 'DEV_SOLD' | 'CRITICAL_RISK' | 'BUILDING' | 'RUNNER'>;
const percent=(value:number)=>`${Number(value.toFixed(2))}%`;
const price=(value:number)=>value>=1?`$${value.toLocaleString('en-US',{maximumFractionDigits:4})}`:`$${value.toPrecision(5).replace(/0+$/,'').replace(/\.$/,'')}`;
const escapeHtml=(value:unknown)=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const displayTicker=(value:unknown)=>{ const symbol=String(value??'').trim().toUpperCase(); return symbol && !symbol.startsWith('0X') ? symbol : null; };
export function verifiedPairAge(pairCreatedAt:number|null|undefined,now=Date.now()):string|null { const created=Number(pairCreatedAt); if(!Number.isFinite(created)||created<=0||created>now)return null; const minutes=Math.floor((now-created)/60_000); if(minutes<60)return`${minutes}m`; const hours=Math.floor(minutes/60); return hours<48?`${hours}h`:`${Math.floor(hours/24)}d`; }

export function buildPremiumTokenNotification(args:{
  state:PremiumState; symbol?:string|null; name?:string|null; address:string; chain?:string|null; observedAt?:string|number|Date|null;
  age?:string|null; market:NotificationMarketContext; evidence?:CoreDecisionMetricContext|null; volumeMultiple?:number|null; move?:number|null; peakMove?:number|null;
  retainedPeakPercent?:number|null; boostTotal?:number|null; boostIncrement?:number|null; devLaunches?:number|null; devBurnPercent?:number|null; risk?:string|null; confidence?:number|null;
  launchSource?:'PONS'|'CUSTOM'|'UNKNOWN'|null;
  insightTitle:string; insight:string[]; statusTitle:string; status:string; displayIntent?:'ENTRY'|'MOMENTUM_UPDATE'|'RECOVERY_WATCH'|'WATCH'|'AVOID'|'EXIT';
  comparison?:{previous:number;current:number;changePct:number}; entryAction?:'BUY'|'CHECK_ENTRY'; structureContext?:string|null;
}) {
  const marketCap=args.market.marketCap, fdv=marketCap==null?args.market.fdv:null, lightweight=['DEX_PAID','BOOST','MAJOR_BOOST'].includes(args.state);
  const unlockedLpWarning = lightweight && args.insight.some(line => /LP\s+UNLOCKED|remains removable|liquidity can be pulled/i.test(line));
  const effectiveRisk = unlockedLpWarning ? 'HIGH — UNLOCKED LP' : args.risk;
  const effectiveStatusTitle = unlockedLpWarning ? 'Liquidity Safety' : args.statusTitle;
  const effectiveStatus = unlockedLpWarning ? '⚠️ UNLOCKED LP — HIGH RUG RISK' : args.status;
  const effectiveStructureContext = unlockedLpWarning
    ? `⚠️ Liquidity is not protected. LP holders can remove liquidity.${args.structureContext ? ` · ${args.structureContext}` : ''}`
    : args.structureContext;
  const metrics=[
    ...(args.market.price==null?[]:[{icon:'💰',label:'Price',value:price(args.market.price)}]), ...(args.age?[{icon:'⏱',label:'Age',value:args.age}]:[]),
    ...(marketCap==null?[]:[{icon:'💵',label:'Market cap',value:formatUsd(marketCap)}]), ...(fdv==null?[]:[{icon:'💰',label:'FDV',value:formatUsd(fdv)}]),
    ...(lightweight&&args.evidence?.devHoldingEvidence==='VERIFIED'&&args.evidence.devHoldingPercent!=null?[{icon:'👨‍💻',label:'Dev holding',value:percent(args.evidence.devHoldingPercent)}]:[]),
    ...(args.market.liquidity==null?[]:[{icon:'💧',label:'Liquidity',value:formatUsd(args.market.liquidity)}]), ...(args.market.volume5m==null?[]:[{icon:'📊',label:'5m volume',value:formatUsd(args.market.volume5m)}]),
    ...(args.volumeMultiple==null?[]:[{icon:'📈',label:'Volume',value:`${args.volumeMultiple.toFixed(1)}×`}]), ...(args.boostTotal==null?[]:[{icon:'⚡',label:'Boost',value:`${args.boostTotal} total${args.boostIncrement==null?'':` (+${args.boostIncrement})`}`}]),
    ...(args.move==null?[]:[{icon:'📊',label:'Move',value:`${args.move>=0?'+':''}${args.move.toFixed(1)}%`}]), ...(args.peakMove==null?[]:[{icon:'🏔',label:'Peak',value:`${args.peakMove>=0?'+':''}${args.peakMove.toFixed(1)}%`}]),
    ...(args.retainedPeakPercent==null?[]:[{icon:'🛡',label:'Retained',value:`${args.retainedPeakPercent}%`}])
  ];

  if (args.state === 'BOOST' || args.state === 'MAJOR_BOOST') {
    const title = args.state === 'MAJOR_BOOST' ? '🚨🔥 MAX BOOST 500+' : '🚀 BOOST DETECTED';
    const symbol = displayTicker(args.symbol);
    const chain = String(args.chain ?? '').trim().toUpperCase();
    const identity = symbol
      ? `<b>$${escapeHtml(symbol)}</b>${args.name ? ` · ${escapeHtml(args.name)}` : ''}`
      : args.name
        ? `<b>${escapeHtml(args.name)}</b> · Symbol unavailable`
        : '<b>Symbol unavailable</b>';
    const launchLabel = args.launchSource === 'PONS' ? 'PONS'
      : args.launchSource === 'CUSTOM' ? 'CUSTOM'
      : 'UNVERIFIED';
    const marketLines = [
      ...(args.boostTotal==null?[]:[`⚡ <b>Boost</b>          ${args.boostTotal} total${args.boostIncrement==null?'':` (+${args.boostIncrement})`}`}]),
      marketCap==null?(fdv==null?'💵 <b>Market cap</b>     Unavailable':`💰 <b>FDV</b>            ${formatUsd(fdv)}`):`💵 <b>Market cap</b>     ${formatUsd(marketCap)}`,
      args.market.liquidity==null?'💧 <b>Liquidity</b>      Unavailable':`💧 <b>Liquidity</b>      ${formatUsd(args.market.liquidity)}`,
      ...(args.market.volume5m==null?[]:[`📊 <b>5m volume</b>      ${formatUsd(args.market.volume5m)}`]),
      args.evidence?.devHoldingEvidence==='VERIFIED'&&args.evidence.devHoldingPercent!=null
        ? `👨‍💻 <b>Dev holding</b>    ${percent(args.evidence.devHoldingPercent)}`
        : '👨‍💻 <b>Dev holding</b>    Unverified',
      args.evidence?.burnEvidence==='VERIFIED'&&args.evidence.burnedPercent!=null
        ? `🔥 <b>Burned</b>         ${percent(args.evidence.burnedPercent)}`
        : '🔥 <b>Burned</b>         Unverified',
      ...(args.move==null?[]:[`📈 <b>Move</b>           ${args.move>=0?'+':''}${args.move.toFixed(1)}%`]),
    ];
    const lines = [
      `<b>${title}</b>`,
      `🧭 Launch: <b>${launchLabel}</b>`,
      identity,
      chain ? `<i>${escapeHtml(chain)}</i>` : '',
      '',
      ...marketLines,
      '',
      '<b>SAFETY</b>',
      unlockedLpWarning
        ? '⚠️ LP unlocked · <b>HIGH RUG RISK</b>'
        : `🛡 ${escapeHtml(args.status)}`,
      unlockedLpWarning ? '✅ No honeypot / sell-restriction flag detected' : '',
      '',
      `<b>CONTRACT</b>`,
      `<code>${escapeHtml(args.address)}</code>`,
      '',
      '<i>Information only · DYOR</i>',
    ].filter(Boolean);
    return lines.join('\n');
  }

  const developerParts=[...(!lightweight&&args.evidence?.devHoldingEvidence==='VERIFIED'&&args.evidence.devHoldingPercent!=null?[`Dev holds ${percent(args.evidence.devHoldingPercent)}`]:[]), ...(args.devBurnPercent!=null&&Number.isFinite(args.devBurnPercent)?[`Dev burned ${percent(args.devBurnPercent)}`]:[]), ...(args.devLaunches!=null&&args.devLaunches>0?[`${args.devLaunches} observed creator launches`]:[])];
  return renderAlphaNotification({
    category:['DEV_SOLD','CRITICAL_RISK'].includes(args.state)?'risk':'market', severity:['DEV_SOLD','CRITICAL_RISK'].includes(args.state)?'critical':['OPPORTUNITY','VOLUME_IGNITION','DEX_PAID','DEV_BURN'].includes(args.state)?'positive':'watch',
    state:args.state,symbol:args.symbol,subtitle:args.name,address:args.address,chain:args.chain,observedAt:args.observedAt,confidence:args.confidence,risk:effectiveRisk,metrics,
    insightTitle:args.insightTitle,insight:args.insight,statusTitle:effectiveStatusTitle,status:effectiveStatus,displayIntent:args.displayIntent??(args.state==='OPPORTUNITY'?'ENTRY':args.state==='DEV_SOLD'||args.state==='CRITICAL_RISK'?'AVOID':'WATCH'),
    comparison:args.comparison,entryAction:args.entryAction,developerContext:developerParts.length?developerParts.join(' · '):null,structureContext:effectiveStructureContext
  });
}