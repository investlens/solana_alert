export type AlphaNotificationCategory = 'opportunity' | 'wallet' | 'creator' | 'smart-money' | 'market' | 'risk' | 'execution' | 'system';
export type AlphaNotificationSeverity = 'info' | 'watch' | 'positive' | 'warning' | 'critical' | 'success';
export type AlphaNotificationState = 'ENTRY_READY' | 'OPPORTUNITY' | 'VOLUME_IGNITION' | 'DEX_PAID' | 'BOOST' | 'MAJOR_BOOST' | 'DEV_BURN' | 'DEV_SOLD' | 'CRITICAL_RISK' | 'BUILDING' | 'RUNNER' | 'WATCHING' | 'BOOSTED_OPPORTUNITY' | 'EXIT_AVOID' | 'WALLET_BUY' | 'WALLET_SELL' | 'WALLET_LAUNCH' | 'WALLET_MOVE' | 'CREATOR_EVENT' | 'RISK' | 'EXECUTED' | 'FAILED' | 'PAUSED' | 'RESUMED' | 'POSITION_UPDATE';
export type AlphaNotificationMetric = { label: string; value: string | number | null | undefined; icon?: string; };
export type AlphaNotification = {
  category: AlphaNotificationCategory; severity: AlphaNotificationSeverity; state: AlphaNotificationState;
  title?: string | null; subtitle?: string | null; token?: string | null; chain?: string | null; symbol?: string | null; address?: string | null; age?: string | null;
  confidence?: number | null; risk?: string | null; metrics?: AlphaNotificationMetric[]; specialistMetrics?: AlphaNotificationMetric[]; evidence?: string[]; reason?: string | null;
  recommendedAction?: string | null; insightTitle?: string | null; insight?: string[]; statusTitle?: string | null; status?: string | null; access?: 'FREE' | 'PRO' | 'ADMIN';
  displayIntent?: 'ENTRY' | 'MOMENTUM_UPDATE' | 'RECOVERY_WATCH' | 'WATCH' | 'AVOID' | 'EXIT'; comparison?: { previous: number; current: number; changePct: number };
  entryAction?: 'BUY' | 'CHECK_ENTRY'; developerContext?: string | null; structureContext?: string | null; observedAt?: string | number | Date | null;
};
export type AlphaNotificationAction = { text: string; url?: string; callback_data?: string; };

const STATE_LABELS: Record<AlphaNotificationState, string> = {
  ENTRY_READY:'🔥 ALPHA ENTRY', OPPORTUNITY:'🔥 ALPHA ENTRY', VOLUME_IGNITION:'🚀 MOMENTUM', DEX_PAID:'💎 DEX PAID EARLY', BOOST:'🚀 MOMENTUM', MAJOR_BOOST:'🚀 MOMENTUM',
  DEV_BURN:'🧠 CREATOR ALPHA', DEV_SOLD:'🚨 RISK / EXIT', CRITICAL_RISK:'🚨 RISK / EXIT', BUILDING:'🚀 MOMENTUM', RUNNER:'🚀 MOMENTUM', WATCHING:'👀 WATCHING',
  BOOSTED_OPPORTUNITY:'🔥 ALPHA ENTRY', EXIT_AVOID:'🚨 RISK / EXIT', WALLET_BUY:'🐋 SMART MONEY', WALLET_SELL:'🚨 RISK / EXIT', WALLET_LAUNCH:'🐋 SMART MONEY', WALLET_MOVE:'🐋 SMART MONEY',
  CREATOR_EVENT:'🧠 CREATOR ALPHA', RISK:'🚨 RISK / EXIT', EXECUTED:'✅ EXECUTED', FAILED:'⚠️ EXECUTION FAILED', PAUSED:'⏸ AUTO TRADE PAUSED', RESUMED:'▶ AUTO TRADE RESUMED', POSITION_UPDATE:'📈 POSITION UPDATE'
};
export function escapeAlphaHtml(value: unknown): string { return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export const TELEGRAM_MESSAGE_LIMIT = 4096;
export function boundedAlphaText(value: unknown,max:number):string { const text=String(value??'').trim(); return text.length<=max?text:`${text.slice(0,Math.max(0,max-1))}…`; }
export function compactAlphaAddress(value?:string|null,start=6,end=5):string { const clean=String(value??'').trim(); if(!clean)return''; return clean.length<=start+end+1?clean:`${clean.slice(0,start)}…${clean.slice(-end)}`; }
export function normalizeAlphaSymbol(value?:string|null):string { return boundedAlphaText(String(value??'').replace(/^\$+/, '').toUpperCase(),64); }
export function alphaStateLabel(state:AlphaNotificationState):string { return STATE_LABELS[state]; }
export function assertAlphaActions(actions:AlphaNotificationAction[][]):AlphaNotificationAction[][] { for(const row of actions)for(const action of row){ if(action.callback_data&&Buffer.byteLength(action.callback_data,'utf8')>64)throw new Error(`Telegram callback_data exceeds 64 bytes: ${action.callback_data}`); if(action.url&&!/^https:\/\//i.test(action.url))throw new Error(`Telegram action URL must use HTTPS: ${action.url}`);} return actions; }
function validMetric(metric:AlphaNotificationMetric):boolean { return metric.value!==null&&metric.value!==undefined&&String(metric.value).trim()!==''; }
function validConfidence(value:number|null|undefined):number|null { return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null; }
function chainLabel(value:string|null|undefined):string|null { const v=String(value??'').trim().toUpperCase(); if(!v)return null; if(v==='ROBINHOOD')return 'ROBINHOOD · PONS'; return v; }
function verdict(alert:AlphaNotification):string {
  const intent=alert.displayIntent;
  if(intent==='EXIT')return 'EXIT'; if(intent==='AVOID')return 'AVOID'; if(intent==='ENTRY')return alert.entryAction==='BUY'?'BUY SETUP':'CHECK ENTRY';
  if(alert.state==='DEX_PAID')return 'EARLY WATCH'; if(['BOOST','MAJOR_BOOST','VOLUME_IGNITION','BUILDING','RUNNER'].includes(alert.state))return 'MOMENTUM WATCH';
  if(alert.category==='wallet'||alert.category==='smart-money')return 'SMART MONEY WATCH'; if(alert.category==='creator')return 'CREATOR WATCH'; return 'WATCH';
}
function observedLabel(value:string|number|Date|null|undefined):string { if(value==null)return 'Observed just now'; const t=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(value); if(!Number.isFinite(t))return 'Observed just now'; const sec=Math.max(0,Math.floor((Date.now()-t)/1000)); return sec<10?'Observed just now':sec<60?`Observed ${sec}s ago`:`Observed ${Math.floor(sec/60)}m ago`; }

export function renderAlphaNotification(alert:AlphaNotification):string {
  const compactAddress=compactAlphaAddress(alert.address), symbol=normalizeAlphaSymbol(alert.symbol), name=boundedAlphaText(alert.subtitle||alert.token||alert.title,80);
  const identity=name&&symbol?`${name} ($${symbol})`:symbol?`$${symbol}`:name||compactAddress;
  const lines:string[]=[`<b>${escapeAlphaHtml(alphaStateLabel(alert.state))}</b>`, ...(chainLabel(alert.chain)?[`<b>${escapeAlphaHtml(chainLabel(alert.chain))}</b>`]:[]), '', `🔥 <b>${escapeAlphaHtml(identity)}</b>`];
  if(alert.address)lines.push(symbol?`<b>${escapeAlphaHtml(symbol)}</b> · <code>${escapeAlphaHtml(compactAddress)}</code>`:`<code>${escapeAlphaHtml(compactAddress)}</code>`);
  const metrics=[...(alert.age?[{label:'Age',value:alert.age}]:[]),...(alert.metrics??[]),...(alert.specialistMetrics??[])].filter(validMetric).slice(0,12);
  const take=(...labels:string[])=>metrics.find(m=>labels.includes(m.label.toLowerCase())); const p=take('price'),mc=take('market cap','fdv'),liq=take('liquidity'),vol=take('5m volume');
  if(p||mc)lines.push('',`${p?`💰 Price <b>${escapeAlphaHtml(boundedAlphaText(p.value,80))}</b>`:''}${p&&mc?'  •  ':''}${mc?`${mc.label} <b>${escapeAlphaHtml(boundedAlphaText(mc.value,80))}</b>`:''}`);
  if(liq||vol)lines.push(`${liq?`💧 Liquidity <b>${escapeAlphaHtml(boundedAlphaText(liq.value,80))}</b>`:''}${liq&&vol?'  •  ':''}${vol?`📊 5m volume <b>${escapeAlphaHtml(boundedAlphaText(vol.value,80))}</b>`:''}`);
  for(const m of metrics.filter(x=>![p,mc,liq,vol].includes(x)).slice(0,4))lines.push(`${m.icon?`${escapeAlphaHtml(m.icon)} `:''}${escapeAlphaHtml(boundedAlphaText(m.label,24))} <b>${escapeAlphaHtml(boundedAlphaText(m.value,80))}</b>`);
  const source=alert.insight?.length?alert.insight:alert.evidence?.length?alert.evidence:alert.reason?[alert.reason]:[];
  const insight=source.flatMap(v=>String(v??'').split(/(?<=[.!?])\s+/)).map(v=>boundedAlphaText(v.replace(/[.!?]+$/,''),140)).filter(Boolean).slice(0,3);
  if(insight.length)lines.push('',`📈 <b>${alert.displayIntent==='ENTRY'?'WHY ALPHAOS LIKES IT':'WHAT CHANGED'}</b>`,...insight.map(x=>`• ${escapeAlphaHtml(x)}`));
  const warnings=[alert.structureContext,alert.developerContext].filter((x):x is string=>Boolean(x&&String(x).trim()));
  if(warnings.length)lines.push('','⚠️ <b>WATCH OUT</b>',...warnings.slice(0,2).map(x=>`• ${escapeAlphaHtml(boundedAlphaText(x,180))}`));
  const risk=String(alert.risk??'UNKNOWN').toUpperCase(), riskIcon=risk==='LOW'?'✅':risk==='MEDIUM'||risk==='REVIEW'?'⚠️':risk==='HIGH'?'🚨':'⚪'; const confidence=validConfidence(alert.confidence);
  lines.push('',`🧠 <b>ALPHAOS VERDICT: ${escapeAlphaHtml(verdict(alert))}${confidence==null?'':` — ${confidence.toFixed(0)}/100`}</b>`,`${riskIcon} <b>Risk:</b> ${escapeAlphaHtml(risk==='MEASURED'?'UNKNOWN':risk)}`);
  if(confidence!=null)lines.push(`<b>Confidence:</b> ${confidence>=85?'HIGH':confidence>=70?'MEDIUM':'LOW'} (${confidence.toFixed(0)}/100)`);
  lines.push(`<i>${escapeAlphaHtml(observedLabel(alert.observedAt))}</i>`);
  if(alert.displayIntent==='WATCH')lines.push('<i>AlphaOS is monitoring for entry confirmation.</i>');
  if(alert.access==='FREE')lines.push('','<i>Free intelligence may be delayed.</i>');
  const rendered=lines.join('\n'); if(rendered.length>TELEGRAM_MESSAGE_LIMIT)throw new Error('Alpha notification exceeds Telegram message limit after bounded rendering'); return rendered;
}
export function burnEvidenceMetric(burnedAmount:number|null|undefined):AlphaNotificationMetric { if(burnedAmount==null||!Number.isFinite(burnedAmount))return{label:'Burn',value:'Data unavailable'}; return{label:'Burn',value:burnedAmount===0?'0 confirmed':`${burnedAmount.toLocaleString()} confirmed`}; }
