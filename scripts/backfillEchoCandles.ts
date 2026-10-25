/**
 * Read-only Echo historical candles. Input JSONL: RESEARCH_EVENT payloads.
 * No trading, Telegram, RPC or production state writes.
 * Usage: node --import tsx scripts/backfillEchoCandles.ts alerts.jsonl output.jsonl
 * Output: one 1m OHLCV candle per caller-token, including source and pool.
 * OHLCV close is not an executable fill; do not treat intra-candle high as achieved profit.
 */
import { readFile, writeFile } from 'node:fs/promises';
type Alert = {caller:string;mint:string;signature:string;side:'BUY'|'SELL';deliveryAt:number};
const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: backfillEchoCandles.ts input.jsonl output.jsonl');
const base='https://api.geckoterminal.com/api/v2';
const headers={'accept':'application/json;version=20230203'};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
let lastRequest=0;
async function get(path:string):Promise<any>{
  const remaining=6500-(Date.now()-lastRequest);
  if(remaining>0) await sleep(remaining);
  lastRequest=Date.now();
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetch(base+path,{headers,signal:AbortSignal.timeout(12000)});
    if(r.status===429||r.status>=500){await sleep(8000*(attempt+1));continue;}
    if(!r.ok) throw Error('GeckoTerminal HTTP '+r.status);
    return r.json();
  }
  throw Error('Price source throttled or unavailable');
}
const valid=(x:any):x is Alert=>x&&typeof x.caller==='string'&&typeof x.mint==='string'&&
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x.mint)&&
  /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(x.signature)&&
  Number.isFinite(x.deliveryAt)&&(x.side==='BUY'||x.side==='SELL');
const alerts:Alert[]=[];
let invalid=0;
for(const line of (await readFile(input,'utf8')).split(/\r?\n/)){
  if(!line.trim())continue;
  try{const value=JSON.parse(line);if(valid(value))alerts.push(value);else invalid++;}
  catch{invalid++;}
}
const earliest=new Map<string,number>();
for(const a of alerts.filter(x=>x.side==='BUY'))earliest.set(a.mint,Math.min(a.deliveryAt,earliest.get(a.mint)??Infinity));
const records:any[]=[];
const failures:any[]=[];
for(const [mint,at] of earliest){
 try{
  const found=await get('/networks/solana/tokens/'+mint+'/pools?page=1');
  const options=(Array.isArray(found.data)?found.data:[])
    .map((v:any)=>({address:String(v?.attributes?.address??''),base:String(v?.relationships?.base_token?.data?.id??''),
      quote:String(v?.relationships?.quote_token?.data?.id??''),reserve:Number(v?.attributes?.reserve_in_usd??0),
      created:Date.parse(v?.attributes?.pool_created_at??'')/1000}))
    .filter((v:any)=>v.address&& (v.base.endsWith('_'+mint)||v.quote.endsWith('_'+mint))&&
      Number.isFinite(v.created)&&v.created<=at+60)
    .sort((a:any,b:any)=>b.reserve-a.reserve);
  const selected=options[0];
  if(!selected){failures.push({mint,reason:'NO_VALID_POOL_AT_ALERT_TIME'});continue;}
  const candles=new Map<number,number[]>();
  let before=Math.floor(at+86400+600);
  for(let page=0;page<3;page++){
    const response=await get('/networks/solana/pools/'+selected.address+'/ohlcv/minute?aggregate=1&limit=1000&currency=usd&token='+mint+'&before_timestamp='+before);
    const list=response?.data?.attributes?.ohlcv_list;
    if(!Array.isArray(list)||!list.length)break;
    let oldest=Infinity;
    for(const c of list){
      if(!Array.isArray(c)||c.length<6||!c.slice(0,6).every((v:any)=>Number.isFinite(Number(v))))continue;
      const ts=Number(c[0]);oldest=Math.min(oldest,ts);
      if(ts>=at-120&&ts<=at+86400+600)candles.set(ts,c.map(Number));
    }
    if(!Number.isFinite(oldest)||oldest<=at-120)break;
    before=oldest-1;
  }
  const sorted=[...candles.values()].sort((a,b)=>a[0]-b[0]);
  if(!sorted.length){failures.push({mint,reason:'NO_HISTORICAL_CANDLES',pool:selected.address});continue;}
  for(const c of sorted)records.push({mint,pool:selected.address,source:'geckoterminal_1m_ohlcv',
    observedAt:c[0],openUsd:c[1],highUsd:c[2],lowUsd:c[3],closeUsd:c[4],volumeUsd:c[5],
    caveat:'minute OHLCV; not transaction execution price'});
 }catch(e){failures.push({mint,reason:String(e).slice(0,140)})}
}
await writeFile(output,records.map(v=>JSON.stringify(v)).join('\n')+'\n');
await writeFile(output+'.coverage.json',JSON.stringify({alerts:alerts.length,buyMints:earliest.size,invalidRows:invalid,
  recoveredMints:new Set(records.map(x=>x.mint)).size,candles:records.length,failures,
  note:'OHLCV is observational, not executable or fee-adjusted. Pool selected using presently reported reserve: potential survivorship bias; validate historical pool identity before scoring.'},null,2));
console.log(JSON.stringify({alerts:alerts.length,buyMints:earliest.size,candles:records.length,failures:failures.length}));
