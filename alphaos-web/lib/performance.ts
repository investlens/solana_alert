import { supabaseAdmin } from './supabase-admin';
export async function loadPerformance() {
 const [tracking,history,coverage]=await Promise.all([
  supabaseAdmin.from('alpha_compact_tracking').select('chain,token,feed,pair_id,price_unit,baseline_price,started_at,samples,outcome').order('started_at',{ascending:false}).limit(100),
  supabaseAdmin.from('alpha_successful_tokens').select('chain,token,feed,price_unit,baseline_price,samples,assessed_at').order('assessed_at',{ascending:false}).limit(100),
  supabaseAdmin.from('alpha_feed_outcome_daily').select('day,chain,feed,tracked,winners,failed,neutral,incomplete,excluded').gte('day',new Date(Date.now()-30*86400000).toISOString().slice(0,10)).order('day',{ascending:false}).limit(1000)
 ]);
 for(const result of [tracking,history,coverage])if(result.error)throw Error('Performance records unavailable');
 const rows=[...(tracking.data??[]),...(history.data??[]).filter(h=>!(tracking.data??[]).some(t=>t.chain===h.chain&&t.token===h.token)).map(h=>({...h,pair_id:null,started_at:null,outcome:'WINNER'}))];
 const items=rows.map(row=>{
  const baseline=Number(row.baseline_price);const start=row.started_at?Date.parse(row.started_at):null;
  const samples=(Array.isArray(row.samples)?row.samples:[]).filter(s=>s&&s.status==='MEASURED'&&Number.isFinite(Number(s.price))&&Number(s.price)>0&&Number.isFinite(Date.parse(s.at))&&(start===null||Date.parse(s.at)>start)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const latest=samples.at(-1);const comparable=row.price_unit==='USD'&&baseline>0&&Number.isFinite(baseline);
  return {chain:row.chain,token:row.token,feed:row.feed,unit:row.price_unit,baseline,startedAt:row.started_at,outcome:row.outcome??'TRACKING',observedAt:latest?.at??null,
   latest:comparable&&latest?Number(latest.price):null,peak:comparable&&samples.length?Math.max(baseline,...samples.map(s=>Number(s.price))):null,
   chart:row.pair_id&&row.price_unit==='USD'?`https://dexscreener.com/${row.chain}/${row.pair_id}`:null};
 });
 return {items,coverage:coverage.data??[],generatedAt:new Date().toISOString()};
}
