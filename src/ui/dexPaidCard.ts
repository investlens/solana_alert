import { escapeAlphaHtml } from './alphaNotification.js';
import { cleanAlertButtons, type CardButton } from './alertCardLayout.js';
import type { AlertKeyStats } from './alertKeyStats.js';

export function buildDexPaidEventCard(args:{text:string;token:string;launchType:string|null;stats:AlertKeyStats|null;
 securityNote:string|null;buttons:CardButton[][];paymentTimestamp?:number|null}) {
 const stats=args.stats;
 const identity=stats?.name ? `${escapeAlphaHtml(stats.name)}${stats.symbol ? ' ($'+escapeAlphaHtml(stats.symbol)+')':''}` : 'Token identity pending';
 const lines=args.text.split('\n');
 const metricLines=lines.filter(line=>/^(?:Price|MC|Market cap|FDV|Liquidity|Vol · (?:5m|24h)|Move · (?:5m|1h)|Trades · 5m|Pair age|Total supply)\s/i.test(line.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z]+/,'')) && !/Unavailable|not confirmed/i.test(line));
 const dev=lines.find(line=>/Dev holding\s/i.test(line)) ?? 'Dev holding <b>Unavailable</b>';
 const top=lines.find(line=>/Top 10(?:\s| ·)/i.test(line)) ?? 'Top 10 <b>Unavailable</b>';
 const age=args.paymentTimestamp && Number.isFinite(args.paymentTimestamp) ? Math.max(0,Math.floor((Date.now()-(args.paymentTimestamp<1e10?args.paymentTimestamp*1000:args.paymentTimestamp))/60000)):null;
 const trusted=args.launchType==='PONS'||args.launchType==='FLAP';
 const risk=trusted ? `Verified ${args.launchType} origin · market risks remain` : args.securityNote ?? 'Sellability unverified · validate selling before investing.';
 const socials=[stats?.twitter && /^https:\/\/(?:x\.com|twitter\.com)\//i.test(stats.twitter) ? `<a href="${escapeAlphaHtml(stats.twitter)}">X</a>`:null,stats?.telegram && /^https:\/\/t\.me\//i.test(stats.telegram) ? `<a href="${escapeAlphaHtml(stats.telegram)}">Telegram</a>`:null].filter(Boolean);
 const text=[`💎 <b>DEX PAID DETECTED</b>`,`<b>${identity}</b>`,`Robinchain${args.launchType ? ' · '+escapeAlphaHtml(args.launchType):''}`,'',
 `Payment <b>Confirmed</b>${age==null?'':` · ${age}m ago`}`,'',
 '<b>MARKET</b>',...new Set(metricLines),
 ...(stats?.preBond ? ['Bonding curve · no DEX market yet'] : !stats?.chartUrl ? ['Market snapshot pending · no confirmed DEX pair'] : []),
 ...(metricLines.length ? ['Other missing stats are not confirmed.'] : ['Price, valuation, liquidity and volume unavailable.']),
 '', '<b>OWNERSHIP</b>',dev,top,
 ...(lines.some(line=>/Creator wallet balance only/.test(line)) ? ['Zero creator balance does not prove a sale or burn.']:[]),
 ...lines.filter(line=>/Concentrated dev holding/.test(line)),
 '', '<b>RISK</b>',risk,
 ...(socials.length ? ['',socials.join(' · ')]:[]),
 '', '<b>CONTRACT</b>',`<code>${args.token}</code>`,'',
 '<i>Paid promotion is not a trade signal · DYOR</i>',
 ...(stats?.source ? [`${escapeAlphaHtml(stats.source)}${stats.checkedAt ? ' · '+escapeAlphaHtml(stats.checkedAt)+' UTC':''}`]:[])].join('\n');
 // Payment is not evidence of an indexed DEX market. Never invent its URL.
 const buttons=args.buttons.flat().filter(b=>!b.url || !/^https:\/\/dexscreener\.com\/robinhood\//i.test(b.url));
 if(stats?.chartUrl && /^https:\/\/dexscreener\.com\/robinhood\//i.test(stats.chartUrl))buttons.unshift({text:'💎 DexScreener',url:stats.chartUrl});
 else if(args.launchType==='PONS')buttons.unshift({text:'🚀 PONS',url:`https://www.ponsfamily.com/launchpad/${args.token}`});
 if(!buttons.some(b=>b.text.includes('Explorer')))buttons.push({text:'🔎 Explorer',url:`https://robinhoodchain.blockscout.com/token/${args.token}`});
 return {text,buttons:cleanAlertButtons([buttons],text)!};
}
