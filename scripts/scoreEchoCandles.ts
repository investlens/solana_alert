/**
 * Score Echo first-BUY opportunities from already recovered 1m candles.
 * Conservative observational proxy: the entry is the CLOSE of the first candle
 * whose START is at/after Telegram delivery (never a pre-alert candle).
 * Returns are gross candle-close marks, NOT fills, and do not validate sellability.
 * Usage: node --import tsx scripts/scoreEchoCandles.ts alerts.jsonl candles.jsonl output.json
 */
import { readFile, writeFile } from 'node:fs/promises';
const [alertsPath,candlesPath,outputPath]=process.argv.slice(2);
if(!alertsPath||!candlesPath||!outputPath)throw Error('Usage: scoreEchoCandles.ts alerts.jsonl candles.jsonl output.json');
function jsonl(path:string){return readFile(path,'utf8').then(s=>s.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean));}
const alerts=(await jsonl(alertsPath)).filter((x:any)=>x.side==='BUY'&&typeof x.caller==='string'&&typeof x.mint==='string'&&Number.isFinite(x.deliveryAt));
const candles=(await jsonl(candlesPath)).filter((x:any)=>typeof x.mint==='string'&&typeof x.pool==='string'&&Number.isFinite(x.observedAt)&&Number.isFinite(x.closeUsd)&&x.closeUsd>0);
const byMint=new Map<string,any[]>();for(const candle of candles){const arr=byMint.get(candle.mint)||[];arr.push(candle);byMint.set(candle.mint,arr);}
for(const arr of byMint.values())arr.sort((a,b)=>a.observedAt-b.observedAt);
const firstBuys=new Map<string,any>();
for(const alert of alerts){const key=alert.caller+':'+alert.mint;const prev=firstBuys.get(key);if(!prev||alert.deliveryAt<prev.deliveryAt)firstBuys.set(key,alert);}
const checkpoints=[300,900,1800,3600,21600,86400];
const results:any[]=[];
for(const [key,a] of firstBuys){
 const all=byMint.get(a.mint)||[];
 // OHLCV timestamps denote candle OPEN, not close. A candle close can only be
 // observed after the full minute; require its full interval after delivery.
 const entry=all.find(c=>c.observedAt>=a.deliveryAt&&c.observedAt<=a.deliveryAt+120);
 const item:any={caller:a.caller,mint:a.mint,deliveryAt:a.deliveryAt,entryAt:entry?.observedAt??null,pool:entry?.pool??null,
  entryCloseUsd:entry?.closeUsd??null,returnsPct:{},coverage:{},classification:'UNSCORED'};
 for(const seconds of checkpoints){
  const target=a.deliveryAt+seconds;
  const c=entry?all.find(v=>v.pool===entry.pool&&v.observedAt>=target&&v.observedAt<=target+120):null;
  item.returnsPct[String(seconds)]=c?Math.round((c.closeUsd/entry.closeUsd-1)*10000)/100:null;
  item.coverage[String(seconds)]=c?'CANDLE_CLOSE_PROXY':'MISSING';
 }
 if(entry)item.classification='UNSCORED_POOL_IDENTITY_UNVERIFIED';
 results.push(item);
}
const counts:Record<string,{opportunities:number,pricedEntries:number,priced24h:number}>={};
for(const x of results){const n=counts[x.caller]??{opportunities:0,pricedEntries:0,priced24h:0};n.opportunities++;if(x.entryAt!==null)n.pricedEntries++;if(x.returnsPct['86400']!==null)n.priced24h++;counts[x.caller]=n;}
await writeFile(outputPath,JSON.stringify({schema:'echo.candle.research.v1',source:'geckoterminal_1m_ohlcv',
 note:'First BUY per caller/token only. OHLCV candle closes are NOT executable fills. Pool chosen by present-day reserve can have survivorship bias; all opportunities remain UNSCORED until historical pool attribution and executable pricing are validated.',
 opportunities:results.length,byCaller:counts,results},null,2));
console.log(JSON.stringify({opportunities:results.length,byCaller:counts}));
