import test from 'node:test';import assert from 'node:assert/strict';
import {createHistoryReader,historyFindings} from '../history.js';
const creator='0x'+'b'.repeat(40),token='0x'+'a'.repeat(40),prior='0x'+'c'.repeat(40),at='2026-10-16T10:00:00Z';
const summary={chain:'robinhood',creator,assessed_sessions:3,winners:1,failed:1,neutral:0,incomplete:1,last_assessed_at:at};
const winner={chain:'robinhood',token:prior,creator,creator_source:'PONS_FACTORY_EVENT',price_unit:'USD',baseline_price:1,final_roi:50,sampled_low_roi:0,samples:[{status:'MEASURED',price:1.1,at:'2026-10-16T05:00:00Z'},{status:'MEASURED',price:1.2,at:'2026-10-16T06:00:00Z'},{status:'MEASURED',price:1.5,at:'2026-10-16T09:00:00Z'}],assessed_at:at};
test('retained outcomes preserve measured units and session scope, excluding current token and unverified arithmetic',()=>{
 const findings=historyFindings('robinhood',creator,token,{summary:[summary],winners:[winner]},at);
 assert.equal(findings.length,2);assert.match(findings[0].limits!,/not lifetime/);assert.match(findings[1].summary,/USD price/);
 assert.equal(historyFindings('robinhood',creator,prior,{summary:[summary],winners:[winner]},at).length,1);
 for(const patch of [{final_roi:999},{creator_source:'INDEXER'},{creator:token},{assessed_at:'2027-01-01'}])assert.equal(historyFindings('robinhood',creator,token,{summary:[summary],winners:[{...winner,...patch}]},at).length,1);
 for(const patch of [{assessed_sessions:99},{winners:-1},{creator:token},{last_assessed_at:'2027-01-01'}])assert.equal(historyFindings('robinhood',creator,token,{summary:[{...summary,...patch}],winners:[winner]},at).length,0);
});
test('history transport performs only exact wallet and chain filtered bounded reads, with no credential-bearing URLs',async()=>{
 const requests:URL[]=[];
 const read=createHistoryReader('https://example.supabase.co','private-key',async(input,init)=>{
  const url=new URL(String(input));requests.push(url);assert.equal(init?.method,undefined);assert.equal(init?.redirect,'error');assert.equal(url.searchParams.get('creator'),'eq.'+creator);assert.equal(url.searchParams.get('chain'),'eq.robinhood');assert.equal(url.href.includes('private-key'),false);
  return new Response(JSON.stringify(url.pathname.endsWith('alpha_successful_tokens')?[winner]:[summary]));
 });
 assert.equal(historyFindings('robinhood',creator,token,await read('robinhood',creator),at).length,2);
 assert.deepEqual(requests.map(u=>u.searchParams.get('limit')),['1','3']);
 assert.equal(requests[1].searchParams.get('order'),'assessed_at.desc');
 await assert.rejects(()=>read('robinhood','invalid'));assert.equal(requests.length,2);
 const unavailable=createHistoryReader('https://example.supabase.co','key',async()=>new Response('',{status:503}));await assert.rejects(()=>unavailable('robinhood',creator));
});
