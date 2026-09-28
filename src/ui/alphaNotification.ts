export type AlphaNotificationCategory = 'opportunity' | 'wallet' | 'creator' | 'smart-money' | 'market' | 'risk' | 'execution' | 'system';
export type AlphaNotificationSeverity = 'info' | 'watch' | 'positive' | 'warning' | 'critical' | 'success';
export type AlphaNotificationState = 'ENTRY_READY' | 'OPPORTUNITY' | 'VOLUME_IGNITION' | 'DEX_PAID' | 'BOOST' | 'MAJOR_BOOST' | 'DEV_BURN' | 'DEV_SOLD' | 'CRITICAL_RISK' | 'BUILDING' | 'RUNNER' | 'WATCHING' | 'BOOSTED_OPPORTUNITY' | 'EXIT_AVOID' | 'WALLET_BUY' | 'WALLET_SELL' | 'WALLET_LAUNCH' | 'WALLET_MOVE' | 'CREATOR_EVENT' | 'RISK' | 'EXECUTED' | 'FAILED' | 'PAUSED' | 'RESUMED' | 'POSITION_UPDATE';
export type AlphaNotificationMetric = { label: string; value: string | number | null | undefined; icon?: string; };
export type AlphaNotification = {
  category: AlphaNotificationCategory; severity: AlphaNotificationSeverity; state: AlphaNotificationState;
  title?: string | null; subtitle?: string | null; token?: string | null; chain?: string | null; source?: string | null; symbol?: string | null; address?: string | null; age?: string | null;
  confidence?: number | null; risk?: string | null; metrics?: AlphaNotificationMetric[]; specialistMetrics?: AlphaNotificationMetric[]; evidence?: string[]; reason?: string | null;
  recommendedAction?: string | null; insightTitle?: string | null; insight?: string[]; statusTitle?: string | null; status?: string | null; access?: 'FREE' | 'PRO' | 'ADMIN';
  displayIntent?: 'ENTRY' | 'MOMENTUM_UPDATE' | 'RECOVERY_WATCH' | 'WATCH' | 'AVOID' | 'EXIT'; comparison?: { previous: number; current: number; changePct: number };
  entryAction?: 'BUY' | 'CHECK_ENTRY'; developerContext?: string | null; structureContext?: string | null; observedAt?: string | number | Date | null;
};
export type AlphaNotificationAction = { text: string; url?: string; callback_data?: string; };

const STATE_LABELS: Record<AlphaNotificationState, string> = {
  ENTRY_READY:'ALPHA ENTRY', OPPORTUNITY:'ALPHA OPPORTUNITY', VOLUME_IGNITION:'VOLUME IGNITION', DEX_PAID:'DEX PAID', BOOST:'BOOST', MAJOR_BOOST:'MAX BOOST 500+', DEV_BURN:'VERIFIED BURN', DEV_SOLD:'DEV SELL', CRITICAL_RISK:'CRITICAL RISK', BUILDING:'MOMENTUM', RUNNER:'RUNNER', WATCHING:'WATCHING', BOOSTED_OPPORTUNITY:'BOOSTED OPPORTUNITY', EXIT_AVOID:'RISK EXIT', WALLET_BUY:'SMART MONEY ENTRY', WALLET_SELL:'SMART MONEY EXIT', WALLET_LAUNCH:'SMART MONEY LAUNCH', WALLET_MOVE:'SMART MONEY MOVEMENT', CREATOR_EVENT:'DEV MOVEMENT', RISK:'RISK ALERT', EXECUTED:'EXECUTED', FAILED:'EXECUTION FAILED', PAUSED:'AUTO TRADE PAUSED', RESUMED:'AUTO TRADE RESUMED', POSITION_UPDATE:'POSITION UPDATE'
};
export function escapeAlphaHtml(value: unknown): string { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export function boundedAlphaText(value: unknown,max:number):string { const text=String(value??'').trim(); return text.length<=max?text:`${text.slice(0,Math.max(0,max-1))}…`; }
export function compactAlphaAddress(value?:string|null,start=6,end=5):string { const clean=String(value??'').trim(); if(!clean)return''; return clean.length<=start+end+1?clean:`${clean.slice(0,start)}…${clean.slice(-end)}`; }
export function normalizeAlphaSymbol(value?:string|null):string { return boundedAlphaText(String(value??'').replace(/^\$+/, '').toUpperCase(),64); }
export function alphaStateLabel(state:AlphaNotificationState):string { return STATE_LABELS[state]; }
export function assertAlphaActions(actions:AlphaNotificationAction[][]):AlphaNotificationAction[][] { for(const row of actions)for(const action of row){ if(action.callback_data&&Buffer.byteLength(action.callback_data,'utf8')>64)throw new Error(`Telegram callback_data exceeds 64 bytes: ${action.callback_data}`); if(action.url&&!/^https:\/\//i.test(action.url))throw new Error(`Telegram action URL must use HTTPS: ${action.url}`);} return actions; }
function validMetric(metric:AlphaNotificationMetric):boolean { return metric.value!==null&&metric.value!==undefined&&String(metric.value).trim()!==''; }
function normLabel(value:string):string { return value.trim().toLowerCase().replace(/[_-]+/g,' '); }
function metricBy(metrics:AlphaNotificationMetric[],...labels:string[]):AlphaNotificationMetric|undefined { const wanted=labels.map(normLabel); return metrics.find(m=>wanted.includes(normLabel(m.label))); }
function fmt(metric?:AlphaNotificationMetric):string { return metric?escapeAlphaHtml(boundedAlphaText(metric.value,80)):''; }
function sourceLabel(alert:AlphaNotification, metrics:AlphaNotificationMetric[]):string|null { const explicit=String(alert.source??'').trim().toUpperCase(); if(explicit)return explicit; const m=metricBy(metrics,'source','launch','launch source','protocol'); return m?String(m.value).trim().toUpperCase():null; }
function sectionPair(leftLabel:string,left?:AlphaNotificationMetric,rightLabel?:string,right?:AlphaNotificationMetric):string|null { if(!left&&!right)return null; const a=left?`${leftLabel}  <b>${fmt(left)}</b>`:''; const b=right&&rightLabel?`${rightLabel}  <b>${fmt(right)}</b>`:''; return a&&b?`${a}   |   ${b}`:a||b; }
function alphaSummary(alert:AlphaNotification):string { const explicit=alert.reason||alert.recommendedAction||alert.insight?.[0]||alert.evidence?.[0]; if(explicit)return boundedAlphaText(explicit,180); const risk=String(alert.risk??'').toUpperCase(); if(risk==='HIGH')return 'High risk — verify liquidity, developer activity and holder structure.'; if(alert.state==='BOOST'||alert.state==='MAJOR_BOOST')return 'Boost detected — monitor market structure and developer behaviour.'; return 'Signal detected — review the verified market and safety data above.'; }

export function renderAlphaNotification(alert:AlphaNotification):string {
  const compactAddress=compactAlphaAddress(alert.address), symbol=normalizeAlphaSymbol(alert.symbol), name=boundedAlphaText(alert.subtitle||alert.token||alert.title,80);
  const specialistMetrics=alert.displayIntent==='EXIT'?[]:(alert.specialistMetrics??[]);
  const metrics=[...(alert.age?[{label:'Age',value:alert.age}]:[]),...(alert.metrics??[]),...specialistMetrics].filter(validMetric).slice(0,24);
  const source=sourceLabel(alert,metrics), chain=String(alert.chain??'').trim().toUpperCase();
  const lines:string[]=[`🚀 <b>ALPHAOS · ${escapeAlphaHtml(alphaStateLabel(alert.state))}</b>`];
  if(symbol&&compactAddress) lines.push('',`<b>${escapeAlphaHtml(symbol)}</b> · <code>${escapeAlphaHtml(compactAddress)}</code>`);
  else if(symbol) lines.push('',`<b>${escapeAlphaHtml(symbol)}</b>`);
  else if(name||compactAddress) lines.push('',`<b>${escapeAlphaHtml(name||compactAddress)}</b>`);
  if(name&&symbol&&name.toUpperCase()!==symbol) lines.push(escapeAlphaHtml(name));
  if(chain||source)lines.push(`<code>${escapeAlphaHtml([chain,source].filter(Boolean).join('  ·  '))}</code>`);

  const boostTotal=metricBy(metrics,'boost','boost total','total boost','boosts'), boostDelta=metricBy(metrics,'boost increase','boost delta','new boost','boost added','boost change');
  if(alert.state==='BOOST'||alert.state==='MAJOR_BOOST'||alert.state==='BOOSTED_OPPORTUNITY'){
    lines.push('','<b>BOOST</b>');
    if(boostTotal||boostDelta) lines.push(`⚡ ${boostTotal?`<b>${fmt(boostTotal)}</b> total`:''}${boostTotal&&boostDelta?' · ':''}${boostDelta?`<b>${fmt(boostDelta)}</b> new`:''}`);
    else lines.push('⚡ <b>Boost detected</b>');
  }

  const mc=metricBy(metrics,'market cap','mc','fdv'), liq=metricBy(metrics,'liquidity','liq'), vol=metricBy(metrics,'5m volume','volume 5m','vol 5m'), age=metricBy(metrics,'age');
  const buys=metricBy(metrics,'buys','5m buys','buys 5m'), sells=metricBy(metrics,'sells','5m sells','sells 5m'), buySell=metricBy(metrics,'buys/sells','buys sells','buy/sell'), pressure=metricBy(metrics,'buy pressure','buy ratio','buy/sell ratio');
  if(mc||liq||vol||age||buys||sells||buySell||pressure){
    lines.push('','<b>MARKET</b>');
    if(mc){ const label=normLabel(mc.label)==='fdv'?'FDV':'Market cap'; lines.push(`${label}  <b>${fmt(mc)}</b>`); }
    if(liq) lines.push(`Liquidity  <b>${fmt(liq)}</b>`);
    if(vol||age){ const r=sectionPair('5m volume',vol,'Age',age); if(r)lines.push(r); }
    const bs=buySell?fmt(buySell):(buys||sells)?`${buys?fmt(buys):'—'}/${sells?fmt(sells):'—'}`:'';
    if(bs||pressure)lines.push(`${bs?`Buys/Sells  <b>${bs}</b>`:''}${bs&&pressure?'   |   ':''}${pressure?`Buy pressure  <b>${fmt(pressure)}</b>`:''}`);
  }

  const dev=metricBy(metrics,'dev','dev holding','developer holding','deployer holding'), devMove=metricBy(metrics,'dev movement','developer movement'), lp=metricBy(metrics,'lp','lp protected','liquidity lock','liquidity locked'), sellTest=metricBy(metrics,'sell test','sell simulation'), holders=metricBy(metrics,'holders','top 10','top 10 holders','holder concentration'), honey=metricBy(metrics,'honeypot');
  if(dev||devMove||lp||sellTest||holders||honey||alert.developerContext||alert.structureContext){
    lines.push('','<b>DEV &amp; SAFETY</b>');
    if(dev)lines.push(`<b>Dev:</b> ${fmt(dev)}`);
    if(devMove)lines.push(`Dev movement  <b>${fmt(devMove)}</b>`);
    if(lp)lines.push(`LP  <b>${fmt(lp)}</b>`);
    if(sellTest)lines.push(`Sell test  <b>${fmt(sellTest)}</b>`);
    if(holders)lines.push(`Holders  <b>${fmt(holders)}</b>`);
    if(honey)lines.push(`Honeypot  <b>${fmt(honey)}</b>`);
    if(alert.developerContext&&!dev)lines.push(`<b>Dev:</b> ${escapeAlphaHtml(boundedAlphaText(alert.developerContext,120))}`);
    if(alert.structureContext&&!lp)lines.push(`Structure  <b>${escapeAlphaHtml(boundedAlphaText(alert.structureContext,140))}</b>`);
  }

  lines.push('','<b>ALPHAOS</b>',`🧠 <b>${escapeAlphaHtml(alphaSummary(alert))}</b>`);
  lines.push('','<i>Information only · DYOR</i>');
  const rendered=lines.join('\n'); if(rendered.length>TELEGRAM_MESSAGE_LIMIT)throw new Error('Alpha notification exceeds Telegram message limit after bounded rendering'); return rendered;
}
export function burnEvidenceMetric(burnedAmount:number|null|undefined):AlphaNotificationMetric { if(burnedAmount==null||!Number.isFinite(burnedAmount))return{label:'Burn',value:'Data unavailable'}; return{label:'Burn',value:burnedAmount===0?'0 confirmed':`${burnedAmount.toLocaleString()} confirmed`}; }
