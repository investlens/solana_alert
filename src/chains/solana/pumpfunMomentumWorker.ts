import { createHash } from 'node:crypto';
import { createPumpCandidateQueue,selectPumpMarket,addPumpObservation,evaluatePumpMomentum,type PumpMarket } from './pumpfunMomentum.js';
import { checkPumpRpc,readPumpEvidence,type PumpEvidence } from './pumpfunEvidence.js';
import { governedDexScreenerJson, DexScreenerQueueCapacityError, DexScreenerProviderBackoffError } from '../../services/dexscreenerRequestGovernor.js';
import { deliverAlphaSemanticEvent } from '../../services/alphaSemanticDeliveryService.js';
import { withResearchDisclosure } from '../../ui/researchDisclosure.js';
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const usd=(n:number)=>n>=1000?`$${(n/1000).toFixed(1)}K`:`$${n.toLocaleString('en-US',{maximumFractionDigits:2})}`;
export function pumpMomentumCard(m:PumpMarket,e:PumpEvidence,ratio:number) {
 return withResearchDisclosure([
  '🎯 <b>PUMPFUN MOMENTUM WATCH</b>',`<b>${escape(m.name)} ($${escape(m.symbol)})</b>`,'Solana · Pump.fun → PumpSwap','',
  '<b>MARKET</b>',`MC <b>${usd(m.marketCap)}</b> · Price <b>$${m.price.toPrecision(5)}</b>`,
  `Liquidity <b>${usd(m.liquidity)}</b> · Supply <b>${e.supply.toLocaleString('en-US')}</b>`,
  `Volume · 5m <b>${usd(m.volume5m)}</b> · 24h <b>${usd(m.volume24h)}</b>`,
  `Move · 5m <b>+${m.change5m.toFixed(1)}%</b>${m.change1h!=null?` · 1h <b>${m.change1h>=0?'+':''}${m.change1h.toFixed(1)}%</b>`:''}`,
  `Trades · 5m <b>${m.buys} buy / ${m.sells} sell</b> · Pair <b>${Math.floor((m.observedAt-m.createdAt)/60_000)}m</b>`,'',
  '<b>WHY ALERTED</b>',`5m volume <b>${ratio.toFixed(2)}×</b> three earlier observed 5m windows; price rising across two checks.`,'',
  '<b>OWNERSHIP & RISK</b>',`Creator fee wallet holding <b>${e.devPercent.toFixed(2)}%</b>`,
  `Top 10 sampled owners <b>${e.top10SamplePercent.toFixed(2)}%</b> · verified pool/curve excluded`,
  'Sampled accounts are not a complete holder census. Fee recipient may differ from launch signer.',
  'Mint/freeze authority disabled · recent sells reported. Exit quote and linked-wallet risk not checked.',
  ...(m.socials.length?[m.socials.map(s=>`<a href="${escape(s.url)}">${s.label}</a>`).join(' · ')]:['Social links not supplied.']),
  '',`<code>${m.mint}</code>`,`DEXScreener + confirmed Solana RPC · ${new Date(m.observedAt).toISOString().slice(11,19)} UTC`,
 ].join('\n'));
}
export function pumpMarketReadFailure(error: unknown): 'MARKET_BUDGET_WAIT' | 'MARKET_PROVIDER_UNAVAILABLE' {
 return error instanceof DexScreenerQueueCapacityError || error instanceof DexScreenerProviderBackoffError ? 'MARKET_BUDGET_WAIT' : 'MARKET_PROVIDER_UNAVAILABLE';
}
let started=false;
export function startPumpfunMomentumWorker() {
 if(started)return;started=true;
 const queue=createPumpCandidateQueue();let socket:WebSocket|null=null,reconnecting:ReturnType<typeof setTimeout>|null=null;
 let running=false,lastProfiles=0,rpcBackoff=0,sequence=0,lastMessage=Date.now();
 const connect=()=>{
  if(typeof WebSocket==='undefined'){console.warn('[PumpMomentum] WEBSOCKET_UNAVAILABLE');return;}
  socket=new WebSocket('wss://pumpportal.fun/api/data');
  socket.onopen=()=>{lastMessage=Date.now();socket!.send(JSON.stringify({method:'subscribeNewToken'}));socket!.send(JSON.stringify({method:'subscribeMigration'}));console.log('[PumpMomentum] FREE_DISCOVERY_CONNECTED');};
  socket.onmessage=async event=>{lastMessage=Date.now();try{const raw=typeof event.data==='string'?event.data:await (event.data as Blob).text();const m=JSON.parse(raw);const type=String(m.txType).toLowerCase();if(['migration','migrate'].includes(type)||m.pool==='pump-amm'||(type==='create'&&queue.stats().candidates<40))queue.seed(String(m.mint??''));}catch{}};
  socket.onerror=()=>console.warn('[PumpMomentum] DISCOVERY_ERROR');
  socket.onclose=()=>{socket=null;if(!reconnecting)reconnecting=setTimeout(()=>{reconnecting=null;connect();},30_000);};
 };
 const read=async(url:string,endpoint:string)=>(await governedDexScreenerJson<unknown>({url,endpoint,caller:'pumpfun_momentum',priority:'BACKGROUND',cacheKey:`pump:${createHash('sha256').update(url).digest('hex')}`,cacheTtlMs:25_000,httpTimeoutMs:4000,queueWaitTimeoutMs:4000}));
 const tick=async()=>{
  if(running)return;running=true;let indexed=0,qualified=0,accepted=0,failed=0,evidenceChecks=0;const reasons:Record<string,number>={};const cycleStarted=Date.now();
  const reason=(r:string)=>{reasons[r]=(reasons[r]??0)+1;};
  try {
   if(Date.now()-lastProfiles>=120_000) {lastProfiles=Date.now();try{const feed=(await read('https://api.dexscreener.com/token-profiles/latest/v1','PROFILES')).value;if(Array.isArray(feed))for(const item of feed)if(item?.chainId==='solana')queue.seed(String(item.tokenAddress??''));}catch(error){const r=pumpMarketReadFailure(error);reason(r);if(r==='MARKET_PROVIDER_UNAVAILABLE')failed++;}}
   const candidates=queue.list();
   for(let at=0;at<candidates.length;at+=30) {
    if(Date.now()-cycleStarted>=20_000){reason('MARKET_BUDGET_WAIT');break;}
    const batch=candidates.slice(at,at+30);let response:Awaited<ReturnType<typeof read>>;
    try{response=await read(`https://api.dexscreener.com/tokens/v1/solana/${batch.map(v=>v.mint).join(',')}`,'TOKEN_BATCH_SOLANA');}catch(error){const r=pumpMarketReadFailure(error);reason(r);if(r==='MARKET_PROVIDER_UNAVAILABLE')failed++;continue;}
    const observed=Date.parse(response.fetchedAt);
    for(const candidate of batch) {
     candidate.lastChecked=Date.now();const m=selectPumpMarket(response.value,candidate.mint,observed);
     if(!m){reason('NO_CONFIRMED_PUMPSWAP_MARKET');continue;}indexed++;addPumpObservation(candidate,m);
     const decision=evaluatePumpMomentum(candidate,Date.now());if(!decision.ready){reason(decision.reason);continue;}qualified++;
     if(evidenceChecks>=2||Date.now()<rpcBackoff){reason('EVIDENCE_BUDGET_WAIT');continue;}evidenceChecks++;
     try {
      const e=await readPumpEvidence(m.mint,m.pair);
      if(e.devPercent>5||e.top10SamplePercent>25){reason('OWNERSHIP_CONCENTRATION');continue;}
      if(Date.now()-m.observedAt>60_000){reason('MARKET_EXPIRED');continue;}
      const eventIdentity=`solana:pumpfun-momentum:${m.mint}`;
      const result=await deliverAlphaSemanticEvent({event:{id:--sequence,eventIdentity,type:'PUMPFUN_MOMENTUM',assetId:m.mint,chain:'solana',ephemeral:true,rawSnapshot:{symbol:m.symbol,name:m.name,price:m.price,marketCap:m.marketCap,liquidity:m.liquidity,volume5m:m.volume5m,pairAddress:m.pair,chartUrl:`https://dexscreener.com/solana/${m.pair}`,creator:e.creator}},
       message:pumpMomentumCard(m,e,decision.ratio!),preserveMessage:true,buttons:[[{text:'📈 Chart',url:`https://dexscreener.com/solana/${m.pair}`},{text:'🚀 Pump.fun',url:`https://pump.fun/coin/${m.mint}`}],[{text:'👤 Creator fee wallet',url:`https://solscan.io/account/${e.creator}`},{text:'📋 Copy CA',callback_data:`COPY_CA_${m.mint}`}]]});
      accepted+=result.delivered;failed+=result.failed;if(result.delivered>0)queue.remove(m.mint);
     } catch(error) {failed++;reason('RPC_OR_FORMAT_UNAVAILABLE');rpcBackoff=Date.now()+60_000;console.warn('[PumpMomentum] EVIDENCE_UNAVAILABLE',{mint:m.mint,reason:error instanceof Error?error.message.replace(/https?:\/\/\S+/g,'[endpoint]'):String(error)});}
    }
   }
   console.log('[PumpMomentum] CYCLE',{...queue.stats(),indexed,qualified,accepted,failed,evidenceChecks,reasons,rawDatabaseWrites:0});
   if(socket&&Date.now()-lastMessage>180_000)socket.close();
  } finally {running=false;}
 };
 connect();void checkPumpRpc().then(()=>console.log('[PumpMomentum] RPC_READY')).catch(()=>{rpcBackoff=Date.now()+60_000;console.warn('[PumpMomentum] RPC_UNAVAILABLE');});
 setInterval(()=>void tick().catch(()=>console.warn('[PumpMomentum] CYCLE_FAILED')),30_000);
 void tick().catch(()=>console.warn('[PumpMomentum] CYCLE_FAILED'));
 console.log('[PumpMomentum] STARTED',{cap:120,retentionMinutes:60,batch:30,intervalSeconds:30,mode:'CONFIRMED_POST_BOND',paidTradeStream:false});
}
