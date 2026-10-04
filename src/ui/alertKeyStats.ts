import { escapeAlphaHtml } from './alphaNotification.js';
export type AlertKeyStats = {
  price?: number|null; marketCap?: number|null; fdv?:number|null; liquidity?:number|null;
  volume5m?:number|null; volume24h?:number|null; move5m?:number|null; move1h?:number|null;
  buys?:number|null;sells?:number|null;pairCreatedAt?:number|null; supply?:string|null;
  authoritativeVenue?: boolean;
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
  add(/(?:^|\n).*\bPrice\s/i,'Price',usd(stats.price));
  add(/(?:Market cap|Market Cap|\bMC\s)/,'MC',usd(stats.marketCap));
  if(n(stats.fdv)&&stats.fdv>0)add(/\bFDV\s/,'FDV',usd(stats.fdv));
  add(/Liquidity|LP liquidity/i,'Liquidity',stats.preBond?'Bonding curve · no DEX LP':usd(stats.liquidity));
  add(/5m volume|5m Volume|Vol(?:ume)?\s*·?\s*5m/i,'Vol · 5m',usd(stats.volume5m));
  add(/Vol(?:ume)?\s*·?\s*24h/i,'Vol · 24h',usd(stats.volume24h));
  add(/Move\s*·?\s*5m/i,'Move · 5m',movement(stats.move5m));
  add(/Move\s*·?\s*1h/i,'Move · 1h',movement(stats.move1h));
  add(/Trades\s*·?\s*5m|Buy \/ sell/i,'Trades · 5m',n(stats.buys)&&n(stats.sells)?`${stats.buys} buy / ${stats.sells} sell`:'Unavailable');
  add(/Launch age|Pair age|\bAge\s/i,'Pair age',n(stats.pairCreatedAt)&&stats.pairCreatedAt>0&&stats.pairCreatedAt<=Date.now()?`${Math.floor((Date.now()-stats.pairCreatedAt)/60000)}m`:'Unavailable');
  add(/Total supply/i,'Total supply',stats.supply??'Unavailable');
  add(/Sellability\s/i,'Sellability',stats.sellability??'Unverified');
  add(/LP status\s/i,'LP status',stats.preBond?'Bonding curve':stats.lp??'Unverified');
  add(/Dex Paid|DEX Paid|DEX PAID DETECTED/i,'DEX Paid',stats.dexPaid??'Unavailable');
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
