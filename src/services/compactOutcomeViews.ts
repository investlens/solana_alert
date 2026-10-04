import { escapeTelegramHtml as esc } from '../ui/escapeHtml.js';
export type OutcomeRead<T> = { state:'ready'; value:T } | { state:'unavailable'; value:null };
export type OutcomeSession = {chain:string;token:string;feed:string;price_unit:string;baseline_price:number;baseline_liquidity?:number|null;samples:any[];started_at?:string;assessed_at?:string;due_at?:string;finalized_at?:string|null;outcome?:string|null};
export type CreatorSummary = {assessed_sessions:number;winners:number;failed:number;neutral:number;incomplete:number;last_assessed_at:string};
export type FeedDay = {day:string;chain:string;feed:string;tracked:number;winners:number;failed:number;neutral:number;incomplete:number;excluded:number};
const cache = new Map<string,{expires:number;value:OutcomeRead<any>}>();
const inflight = new Map<string,Promise<OutcomeRead<any>>>();
let reads=0, minute=0, pausedUntil=0;
export function validOutcomeAddress(chain:string,address:string) {return chain==='solana' ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) : ['arc','robinhood'].includes(chain) && /^0x[0-9a-f]{40}$/i.test(address);}
async function cachedRead<T>(key:string, query:()=>Promise<T>, ttl=30000):Promise<OutcomeRead<T>> {
 const now=Date.now(); for(const [k,v] of cache) if(v.expires<=now) cache.delete(k);
 const existing=cache.get(key); if(existing) return existing.value;
 if(inflight.has(key)) return inflight.get(key)!;
 if(minute!==Math.floor(now/60000)){minute=Math.floor(now/60000);reads=0;}
 if(now<pausedUntil || reads>=20 || inflight.size>=2) return {state:'unavailable',value:null};
 reads++;
 const work=(async():Promise<OutcomeRead<T>>=>{let result:OutcomeRead<T>;
  try{result={state:'ready',value:await query()};}catch{pausedUntil=Date.now()+60000;result={state:'unavailable',value:null};console.warn('[CompactViews] lookup unavailable; read budget paused');}
  if(cache.size>=100) cache.delete(cache.keys().next().value!);
  cache.set(key,{value:result,expires:Date.now()+(result.state==='ready'?ttl:15000)});return result;
 })();inflight.set(key,work);try{return await work;}finally{inflight.delete(key);}
}
export function getCompactTokenView(chain:string,token:string):Promise<OutcomeRead<OutcomeSession|null>> {
 if(!validOutcomeAddress(chain,token)) return Promise.resolve({state:'unavailable',value:null});
 const address=chain==='solana'?token:token.toLowerCase();
 return cachedRead(`token:${chain}:${address}`,async()=>{
  const {supabase}=await import('./supabase.js');
  const current=await supabase.from('alpha_compact_tracking').select('chain,token,feed,price_unit,baseline_price,baseline_liquidity,samples,started_at,due_at,finalized_at,outcome').eq('chain',chain).eq('token',address).limit(1).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
  if(current.error) throw current.error; if(current.data) return current.data as OutcomeSession;
  const archive=await supabase.from('alpha_successful_tokens').select('chain,token,feed,price_unit,baseline_price,samples,assessed_at').eq('chain',chain).eq('token',address).limit(1).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
  if(archive.error) throw archive.error; return archive.data?{...archive.data,outcome:'WINNER'} as OutcomeSession:null;
 });
}
export function getCompactCreatorView(chain:string,creator:string):Promise<OutcomeRead<CreatorSummary|null>> {
 if(!validOutcomeAddress(chain,creator)) return Promise.resolve({state:'unavailable',value:null});
 return cachedRead(`creator:${chain}:${chain==='solana'?creator:creator.toLowerCase()}`,async()=>{
  const {supabase}=await import('./supabase.js');const r=await supabase.from('alpha_creator_outcome_summary').select('assessed_sessions,winners,failed,neutral,incomplete,last_assessed_at').eq('chain',chain).eq('creator',chain==='solana'?creator:creator.toLowerCase()).limit(1).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
  if(r.error) throw r.error;return r.data as CreatorSummary|null;
 });
}
export function getCompactFeedView():Promise<OutcomeRead<FeedDay[]>> {
 return cachedRead('feeds:7d',async()=>{const {supabase}=await import('./supabase.js');
 const day=new Date(Date.now()-6*86400000).toISOString().slice(0,10);
 const r=await supabase.from('alpha_feed_outcome_daily').select('day,chain,feed,tracked,winners,failed,neutral,incomplete,excluded').gte('day',day).order('day',{ascending:false}).limit(128).abortSignal(AbortSignal.timeout(1500));
 if(r.error) throw r.error;return r.data as FeedDay[];},60000);
}
const count=(v:unknown)=>Number.isFinite(Number(v))?Math.max(0,Math.floor(Number(v))):0;
const pct=(v:number)=>`${v>=0?'+':''}${v.toFixed(1)}%`;
const time=(v?:string|null)=>v&&Number.isFinite(Date.parse(v))?new Date(v).toISOString().slice(0,16).replace('T',' ')+' UTC':'Unavailable';
export function renderCompactTokenView(chain:string,token:string,result:OutcomeRead<OutcomeSession|null>):string {
 const lines=['⭐ <b>ALPHAOS · ALERT TRACKING</b>',`${esc(chain==='robinhood'?'Robinchain':chain)} · <code>${esc(token)}</code>`,''];
 if(result.state==='unavailable') return [...lines,'Outcome data temporarily unavailable. Retry shortly.'].join('\n');
 const row=result.value;
 if(!row) return [...lines,'No compact tracking record is available for this token.','Only admitted, delivered alerts are assessed. Older non-winning details expire after seven days.'].join('\n');
 lines.push(`Feed  <b>${esc(row.feed.replace(/_/g,' '))}</b>`, `Status  <b>${esc(row.outcome==='NEUTRAL'?'OTHER · neither outcome threshold met':row.outcome??'CHECKPOINTS PENDING')}</b>`, `Series  ${row.price_unit==='USD'?'USD price':'Native ETH reserve ratio'}`,'');
 const samples=Array.isArray(row.samples)?row.samples.slice(0,3):[];const baseline=Number(row.baseline_price);
 const measured=samples.filter(s=>s?.status==='MEASURED' && Number.isFinite(Number(s.price)) && Number(s.price)>0);
 if(Number.isFinite(baseline)&&baseline>0&&measured.length){
  const returns=measured.map(s=>(Number(s.price)/baseline-1)*100);
  lines.push(`Last sampled return  <b>${pct(returns[returns.length-1])}</b>`,`Sampled high / low  ${pct(Math.max(0,...returns))} / ${pct(Math.min(0,...returns))}`);
  if(returns[returns.length-1]<0) lines.push('⚠️ Last sampled price is below the alert baseline.');
 }
 if(row.price_unit==='USD') {
  const last=samples[samples.length-1];
  const liquidity=last?.status==='MEASURED' && last.liquidity!=null ? Number(last.liquidity) : NaN;
  const initial=Number(row.baseline_liquidity);
  if(Number.isFinite(liquidity)&&liquidity>=0) {
   lines.push(`Last sampled liquidity  <b>$${liquidity.toFixed(2)}</b>`);
   if(Number.isFinite(initial)&&initial>0) lines.push(`Liquidity change from alert  ${pct((liquidity/initial-1)*100)}`);
   if(liquidity<2000 || (initial>0&&liquidity/initial<=0.5)) lines.push('⚠️ Thin or sharply reduced sampled liquidity · Quoted price may not be executable.');
  } else lines.push('Last sampled liquidity  Unavailable');
 }
 lines.push('', '<b>CHECKPOINTS</b>');
 ['15m','1h','6h'].forEach((label,i)=>{const s=samples[i]; const p=Number(s?.price);
  lines.push(`${label}  ${!s?'Pending':s.status==='MEASURED'&&s.price!=null&&p>0&&Number.isFinite(p)&&baseline>0?pct((p/baseline-1)*100):'Data unavailable'}`);
 });
 if(samples.length) lines.push(`Last check  ${time(samples[samples.length-1]?.at)}`);
 if(!row.outcome) lines.push(`Next due  ${time(row.due_at)}`);
 lines.push('','Sampled gross price changes · Not ATH or trade profit.','Missing samples remain incomplete · Research only.');return lines.join('\n');
}
export function renderCompactCreatorView(chain:string,creator:string,result:OutcomeRead<CreatorSummary|null>):string {
 const lines=['👤 <b>ALPHAOS · CREATOR OUTCOMES</b>',`${esc(chain==='robinhood'?'Robinchain':chain)} · <code>${esc(creator)}</code>`,''];
 if(result.state==='unavailable') return [...lines,'Creator outcome data temporarily unavailable.'].join('\n');
 const row=result.value;if(!row||!count(row.assessed_sessions)) return [...lines,'No assessed outcomes yet.','This does not mean the wallet has no prior launches.','Only verified creator attribution enters these totals.'].join('\n');
 const completed=count(row.winners)+count(row.failed)+count(row.neutral);
 lines.push(`Assessed sessions  <b>${count(row.assessed_sessions)}</b>`,`Winners / Failed / Other  <b>${count(row.winners)} / ${count(row.failed)} / ${count(row.neutral)}</b>`,`Incomplete  ${count(row.incomplete)}`);
 if(completed) lines.push(`Winner share  <b>${(count(row.winners)/completed*100).toFixed(1)}%</b> of ${completed} complete sessions`);
 lines.push(`Last assessed  ${time(row.last_assessed_at)}`,'','Winner: ≥+25% at 6h; sampled low ≥−30%.','Failed: 6h ≤−50% or sampled low ≤−80%.','Other can include substantial losses or gains; neither threshold was met.','Price classifications do not assess execution or liquidity quality.','Partial coverage · Sessions are not total launches.','Losing outcomes do not establish fraud.');return lines.join('\n');
}
export function renderCompactFeedView(result:OutcomeRead<FeedDay[]>):string {
 const lines=['📊 <b>ALPHAOS · TRACK RECORD</b>','Last 7 UTC calendar days · Grouped by alert day',''];
 if(result.state==='unavailable') return [...lines,'Performance data temporarily unavailable.'].join('\n');
 if(!result.value.length) return [...lines,'No assessed outcomes yet.','New admitted alerts need six hours to complete.'].join('\n');
 const totals=new Map<string,{tracked:number;winners:number;failed:number;neutral:number;incomplete:number;excluded:number}>();
 for(const r of result.value){const key=`${r.chain} · ${r.feed.replace(/_/g,' ')}`;const v=totals.get(key)??{tracked:0,winners:0,failed:0,neutral:0,incomplete:0,excluded:0};for(const k of Object.keys(v) as (keyof typeof v)[]) v[k]+=count(r[k]);totals.set(key,v);}
 for(const [key,r] of [...totals].slice(0,8)){lines.push(`<b>${esc(key)}</b>`,`Tracked ${r.tracked} · Pending ${Math.max(0,r.tracked-r.winners-r.failed-r.neutral-r.incomplete)}`,`Winners ${r.winners} · Failed ${r.failed} · Other ${r.neutral}`,`Incomplete ${r.incomplete} · Excluded admissions ${r.excluded}`,'');}
 if(totals.size>8||result.value.length===128) lines.push('Display is capped; this is a partial report.');
 lines.push('Coverage: admitted, delivered alerts only; rejected/unseen tokens are not measured.',
 'Three checkpoints cannot establish true ATH or maximum drawdown. Fees, gas and slippage excluded.',
 'Excluded counts are best effort. Missing data is not a loss.','First admitted feed owns attribution; repeat boosts reuse it.','Winner: ≥+25% at 6h, sampled low ≥−30%.','Failed: 6h ≤−50% or sampled low ≤−80%.','Other can include substantial losses or gains; neither threshold was met.','Price classifications do not assess execution or liquidity quality.','Sampled outcomes · Not executable trade returns.');return lines.join('\n');
}
export function getCompactTrackingHealth():Promise<OutcomeRead<{active:number;overdue:number}>> {
 return cachedRead('health',async()=>{const {supabase}=await import('./supabase.js');
 const r=await supabase.from('alpha_compact_tracking').select('due_at').is('finalized_at',null).order('due_at').limit(21).abortSignal(AbortSignal.timeout(1500));
 if(r.error) throw r.error;return {active:r.data.length,overdue:r.data.filter(row=>Date.parse(row.due_at)<Date.now()-5*60000).length};},60000);
}
