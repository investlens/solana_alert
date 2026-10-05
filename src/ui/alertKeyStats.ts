import { escapeAlphaHtml } from './alphaNotification.js';
export type AlertKeyStats = {
  price?: number|null; marketCap?: number|null; fdv?:number|null; liquidity?:number|null;
  volume5m?:number|null; volume24h?:number|null; move5m?:number|null; move1h?:number|null;
  buys?:number|null;sells?:number|null;pairCreatedAt?:number|null; supply?:string|null;
  creator?:string|null; chartUrl?: string|null; twitter?:string|null; telegram?:string|null; authoritativeVenue?: boolean;
  preBond?:boolean; sellability?:string|null; lp?:string|null; source?:string|null; checkedAt?:string|null; dexPaid?:string|null; symbol?:string|null; name?:string|null;
};
const n=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const usd=(v:unknown)=>n(v)&&v>=0?'$'+(v>=1000?(v/1000).toLocaleString('en-US',{maximumFractionDigits:2})+'K':v===0?'0':v.toPrecision(5)):'Unavailable';
const movement=(v:unknown)=>n(v)?`${v>=0?'+':''}${v.toFixed(2)}%`:'Unavailable';
// Complete missing fields without overwriting already verified valuation/ownership.
// Render once per token before fan-out; no fetches or persistence in this helper.
export function withAlertKeyStats(text:string, stats:AlertKeyStats):string {
  let clean=text.replace(/\n*<b>KEY STATS<\/b>\n[\s\S]*?(?=\n\n|$)/g,'');
  if (stats.authoritativeVenue) clean=clean.split('\n').filter(line=>{
    const plain=line.replace(/<[^>]+>/g,'').replace(/^[^A-Za-z0-9]+/,'');
    return !/^(?:Price\s|Market cap\s|MC\s|FDV\s|Liquidity\s|LP liquidity\s|5m volume\s|Vol(?:ume)?\s*·?\s*(?:5m|24h)\s|Move\s*·?\s*(?:5m|1h)\s|Trades\s*·?\s*5m\s|Buy \/ sell\s|Pair age\s|LP status\s|Source .*Checked|DEXScreener\s*·\s*Checked)/i.test(plain);
  }).join('\n');
  const plain=clean.replace(/<[^>]+>/g,'');
  const lines:string[]=[];
  const add=(pattern:RegExp,label:string,value:string)=>{if(!pattern.test(plain))lines.push(`${label} <b>${escapeAlphaHtml(value)}</b>`);};
  add(/(?:^|\n)(?:[^A-Za-z0-9\n]*)(?:Token )?Price\s/i,'Price',usd(stats.price));
  add(/(?:Market cap|Market Cap|\bMC\s)/,'MC',usd(stats.marketCap));
  if(n(stats.fdv)&&stats.fdv>0 && (!n(stats.marketCap) || stats.marketCap !== stats.fdv))add(/\bFDV\s/,'FDV',usd(stats.fdv));
  add(/Liquidity|LP liquidity/i,'Liquidity',stats.preBond?'Bonding curve · no DEX LP':usd(stats.liquidity));
  add(/5m volume|5m Volume|Vol(?:ume)?\s*·?\s*5m/i,'Vol · 5m',usd(stats.volume5m));
  add(/Vol(?:ume)?\s*·?\s*24h/i,'Vol · 24h',usd(stats.volume24h));
  add(/Move\s*·?\s*5m/i,'Move · 5m',movement(stats.move5m));
  add(/Move\s*·?\s*1h/i,'Move · 1h',movement(stats.move1h));
  add(/Trades\s*·?\s*5m|Buy \/ sell/i,'Trades · 5m',n(stats.buys)&&n(stats.sells)?`${stats.buys} buy / ${stats.sells} sell`:'Unavailable');
  const age=n(stats.pairCreatedAt)&&stats.pairCreatedAt>0&&stats.pairCreatedAt<=Date.now()?Math.floor((Date.now()-stats.pairCreatedAt)/60000):null;
  add(/Launch age|Pair age|\bAge\s/i,'Pair age',age===null?'Unavailable':age<60?`${age}m`:age<1440?`${Math.floor(age/60)}h ${age%60}m`:`${Math.floor(age/1440)}d ${Math.floor(age%1440/60)}h`);
  const supply=Number(stats.supply?.replace(/,/g,''));
  const compactSupply=stats.supply && Number.isFinite(supply) && supply>=1000 ? (supply/(supply>=1e9?1e9:supply>=1e6?1e6:1e3)).toLocaleString('en-US',{maximumFractionDigits:2})+(supply>=1e9?'B':supply>=1e6?'M':'K') : stats.supply;
  add(/Total supply/i,'Total supply',compactSupply??'Unavailable');
  // A pending authoritative venue is one missing snapshot, not ten separate
  // failures. Keep independently measured supply and all risk disclosures.
  const venuePending = stats.authoritativeVenue && /pending/i.test(stats.source ?? '')
    && ![stats.price, stats.marketCap, stats.fdv, stats.liquidity, stats.volume5m, stats.volume24h].some(n);
  if (venuePending) {
    const supplyLine = lines.find(line => line.startsWith('Total supply '));
    lines.length = 0;
    lines.push('Market data <b>Pending venue confirmation</b>',
      'Price, valuation, liquidity, volume, movements, trades and age are not confirmed.');
    if (supplyLine) lines.push(supplyLine);
  }
  add(/Sellability\s/i,'Sellability',stats.sellability??'Unverified');
  add(/LP (?:lock )?status\s/i,'LP lock status',stats.preBond?'Bonding curve':!stats.lp || stats.lp==='Unverified'?'Not independently checked':stats.lp);
  add(/Dex Paid|DEX PAID DETECTED/i,'DEX Paid',stats.dexPaid??'Unavailable');
  if (!/SOCIALS|SOCIAL LINKS|href="https:\/\/(?:x.com|t.me)/i.test(clean)) lines.push('Socials <b>Unavailable</b>');
  if(!stats.source) lines.push('Source <b>Unavailable</b> · missing stats are not confirmed');
  if(stats.source&&stats.checkedAt)lines.push(`Source ${escapeAlphaHtml(stats.source)} · Checked ${escapeAlphaHtml(stats.checkedAt)} UTC`);
  const block=lines.length?'<b>KEY STATS</b>\n'+lines.join('\n'):'';
  const at=clean.indexOf('<b>OWNERSHIP</b>')>=0?clean.indexOf('<b>OWNERSHIP</b>'):clean.indexOf('<b>CONTRACT</b>');
  let result=at>=0?clean.slice(0,at).trimEnd()+'\n\n'+block+'\n\n'+clean.slice(at):clean.trimEnd()+'\n\n'+block;
  const warning='Validate the contract, ownership and liquidity before investing.';
  if(!result.includes(warning))result+='\n<i>'+warning+'</i>';
  return result;
}
