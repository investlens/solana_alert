import { escapeAlphaHtml as esc } from './alphaNotification.js';
import { cleanAlertButtons, type CardButton } from './alertCardLayout.js';
import { withAlertKeyStats, type AlertKeyStats } from './alertKeyStats.js';
export type PromotionCardArgs = {text:string;token:string;launchType:string|null;stats:AlertKeyStats|null;securityNote:string|null;buttons:CardButton[][];paymentTimestamp?:number|null;kind:'BOOST'|'DEX_PAID'|'SOCIAL_MAFIA'};
export function buildPromotionEventCard(args:PromotionCardArgs) {
 const s=args.stats, lines=args.text.split('\n');
 const plain=args.text.replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
 const producer=plain.match(/(?:^|\n)\$([A-Za-z_][A-Za-z0-9_]{0,23})\s*·\s*([^\n]+)/);
 const compact=plain.match(/(?:^|\n)([^\n]+) \(\$([A-Za-z_][A-Za-z0-9_]{0,23})\)/);
 const name=s?.name ?? producer?.[2]?.trim() ?? compact?.[1]?.trim(),symbol=s?.symbol ?? producer?.[1]?.trim() ?? compact?.[2]?.trim();
 const identity=name ? `${esc(name)}${symbol?' ($'+esc(symbol)+')':''}` : symbol ? '$'+esc(symbol) : 'Token identity pending';
 // Normalize legacy combined rows before selecting one row per metric. Structured
 // snapshot values take precedence; missing snapshot fields retain producer facts.
 const metricRows = lines.flatMap(line=>line.split(/\s*·\s*(?=(?:[^A-Za-z<]*)(?:Market cap|MC|FDV|Liquidity|5m volume|Price)\s)/i))
   .map(line=>line.replace(/^[^A-Za-z0-9<]+/,'').trim());
 const snapshotRows=s?withAlertKeyStats('',s).split('\n'):[];
 const definitions=[
   [/^(?:MC|Market cap)\s/i,'market cap'],[/^FDV\s/i,'FDV'],[/^Price\s/i,'price'],
   [/^(?:Liquidity|LP liquidity)\s/i,'liquidity'],[/^(?:Vol · 5m|5m volume)\s/i,'5m volume'],
   [/^Vol · 24h\s/i,'24h volume'],[/^Move · 5m\s/i,'5m change'],[/^Move · 1h\s/i,'1h change'],
   [/^Trades · 5m\s/i,'trades'],[/^Pair age\s/i,'pair age'],[/^Total supply\s/i,'supply'],[/^Volume · PONS total\s/i,'total volume'],[/^Curve reserve\s/i,'curve reserve'],[/^Bonding progress\s/i,'bonding progress']
 ] as const;
 const plainRow=(row:string)=>row.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z0-9]+/,'');
 const usable=(row:string)=>! /Unavailable|not confirmed/i.test(row);
 const metrics:string[]=[], absent=new Set<string>();
 for(const [pattern,label] of definitions){
   const row=snapshotRows.find(row=>pattern.test(plainRow(row))&&usable(row))
     ??(s?.authoritativeVenue&&s.preBond?undefined:metricRows.find(row=>pattern.test(plainRow(row))&&usable(row)));
   if(row)metrics.push(row);
   else if(label==='market cap')metrics.push('Market cap <b>Unavailable</b>'+(typeof s?.fdv==='number'&&s.fdv>0?' · FDV shown; circulating supply unconfirmed':''));
   else absent.add(label);
 }
 const unavailable=['price','liquidity','5m volume','24h volume','1h change','supply'].filter(label=>absent.has(label));
 const dev=lines.find(l=>/Dev holding\s/i.test(l))??'Dev holding <b>Unavailable</b>';
 const top=lines.find(l=>/Top 10(?:\s| ·)/i.test(l))??'Top 10 <b>Unavailable</b>';
 const creator=s?.creator && /^0x[a-f0-9]{40}$/i.test(s.creator) && !/^0x0{40}$/i.test(s.creator)
   ? `Creator <a href="https://robinhoodchain.blockscout.com/address/${s.creator}">${s.creator.slice(0,8)}…${s.creator.slice(-4)}</a>`
   : lines.find(l=>/^Creator\s+0x/i.test(l.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z]+/,'')));
 const age=args.paymentTimestamp&&Number.isFinite(args.paymentTimestamp)?Math.max(0,Math.floor((Date.now()-(args.paymentTimestamp<1e10?args.paymentTimestamp*1000:args.paymentTimestamp))/60000)):null;
 const trusted=args.launchType==='PONS'||args.launchType==='FLAP';
 const risk=trusted?`Verified ${args.launchType} origin · ownership and market risks remain`:esc(args.securityNote??'Sellability unverified · validate selling before investing.');
 const socials=[s?.twitter&&/^https:\/\/(?:x\.com|twitter\.com)\//i.test(s.twitter)?`<a href="${esc(s.twitter)}">X</a>`:null,s?.telegram&&/^https:\/\/t\.me\//i.test(s.telegram)?`<a href="${esc(s.telegram)}">Telegram</a>`:null].filter(Boolean);
 // Preserve already-rendered clickable socials when public metadata is unavailable.
 if(!socials.length)for(const l of lines)if(/href="https:\/\/(?:x\.com|twitter\.com|t\.me)\//i.test(l))socials.push(l);
 const boost=lines.find(l=>/^Boost\s+\d/i.test(l.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z]+/,'')));
 const paid=lines.find(l=>/^(?:Dex Paid|DEX Paid)\s/i.test(l.replace(/<[^>]+>/g,'')));
 const title=args.kind==='SOCIAL_MAFIA'?'🕶️ <b>SOCIAL MAFIA</b>':args.kind==='DEX_PAID'?'💎 <b>DEX PAID DETECTED</b>':/BOOST INCREASED/.test(args.text)?'🚀 <b>BOOST INCREASED</b>':'🚀 <b>BOOST DETECTED</b>';
 const text=[title,`<b>${identity}</b>`,`Robinchain${args.launchType?' · '+esc(args.launchType):''}`,
 ...(args.kind==='SOCIAL_MAFIA'?lines.filter(l=>/^(?:Contract evidence|X announcement|Telegram type|Evidence|Activity check)\s/.test(l.replace(/<[^>]+>/g,''))):args.kind==='DEX_PAID'?[`Payment <b>Confirmed</b>${age==null?'':` · ${age}m ago`}`]:[boost??'Boost purchase detected',...(paid?[paid]:[])]),'',
 '<b>MARKET</b>',...new Set(metrics),...(unavailable.length?['Market data incomplete · use Full Intel to recheck']:[]),
 ...(s?.preBond?['Bonding curve · no DEX market yet']:!s?.chartUrl?['Trading venue unconfirmed']:[]),
 ...(!metrics.length?['Market snapshot pending']:[]),'',
 '<b>OWNERSHIP</b>',...(creator?[creator]:[]),dev,top,
 ...(lines.some(l=>/Creator wallet balance only/.test(l))?['Zero creator balance does not prove a sale or burn.']:[]),
 ...lines.filter(l=>/Concentrated dev holding|^Creator balance change|^Dev observed|^Holder sample observed/.test(l)),
 ...lines.filter(l=>/^(?:Burned|Verified dev burn)\s/i.test(l.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z]+/,''))&&!/Unavailable|Unverified/i.test(l)),'',
 '<b>RISK</b>',risk,
 ...(socials.length?['',socials.join(' · ')]:[]),'',
 `<code>${esc(args.token)}</code>`,args.kind==='SOCIAL_MAFIA'?'<i>Project acknowledgement · market risks remain · DYOR</i>':'<i>Promotion event · DYOR</i>',
 ...(s?.source?[`${esc(s.source)}${s.checkedAt?' · '+esc(s.checkedAt)+' UTC':''}`]:[])].join('\n');
 const original=args.buttons.flat();
 const chart=!s?.preBond&&s?.chartUrl&&/^https:\/\/dexscreener\.com\/robinhood\//i.test(s.chartUrl)?{text:'📈 Chart',url:s.chartUrl}:null;
 const venue=chart??(args.launchType==='PONS'?{text:'🚀 PONS',url:`https://www.ponsfamily.com/launchpad/${args.token}`}:{text:'🔎 Explorer',url:`https://robinhoodchain.blockscout.com/token/${args.token}`});
 const intel=original.find(b=>/Full Intel/i.test(b.text))??{text:'🧠 Full Intel',callback_data:`FI_RH_${args.token}`};
 const track=original.find(b=>/Track/i.test(b.text))??{text:'⭐ Track',callback_data:`BOOST_TRACK_${args.token}`};
 const copy=original.find(b=>/Copy CA/i.test(b.text))??{text:'📋 Copy CA',callback_data:`COPY_CA_${args.token}`};
 const extras=original.filter(b=>![intel,track,copy].includes(b)&&!/DexScreener|Chart|Explorer|PONS/i.test(b.text)&&!(b.url&&/^https:\/\/(?:dexscreener\.com|www\.ponsfamily\.com)\//.test(b.url)));
 const cleaned=cleanAlertButtons([[venue,intel],[track,copy],extras],text)!;
 // Common cleaner ranks PONS after callbacks; enforce the promotion-card venue row.
 const flat=cleaned.flat(),index=flat.findIndex(b=>b.url===venue.url);if(index>0)flat.unshift(...flat.splice(index,1));
 return {text,buttons:Array.from({length:Math.ceil(flat.length/2)},(_,i)=>flat.slice(i*2,i*2+2))};
}
