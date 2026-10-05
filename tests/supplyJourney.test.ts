import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeSupplyJourney,decodeJourneyTransfers,supplyPercent,type JourneyDependencies} from '../src/services/supplyJourney.js';
import {renderSupplyJourney,supplyJourneyButtons} from '../src/ui/supplyJourneyView.js';
import {PONS_CONTRACTS} from '../src/chains/robinhood/ponsContracts.js';
const token='0x'+'a'.repeat(40),creator='0x'+'b'.repeat(40),recipient='0x'+'c'.repeat(40),curve='0x'+'d'.repeat(40),hash='0x'+'e'.repeat(64);
const topic=(address:string)=>'0x'+address.slice(2).padStart(64,'0');
const log=(to=recipient,index=0)=>({address:token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(creator),topic(to)],data:'0x'+(100n).toString(16).padStart(64,'0'),transactionHash:hash,blockNumber:'0xbb8',logIndex:'0x'+index.toString(16),removed:false});
function fixture(logs:any[]=[log()],opts:{badBalance?:boolean;reorg?:boolean}={}){
 let blocks=0;const calls:{method:string;params:unknown[]}[]=[];
 const d:JourneyDependencies={now:()=>100000,marker:async()=>({token,creator,curveAddress:curve,factory:PONS_CONTRACTS.factory}),rpc:async<T>(method:string,params:unknown[])=>{calls.push({method,params});
 if(method==='eth_chainId')return '0x1237' as T;
 if(method==='eth_blockNumber')return '0xbe0' as T;
 if(method==='eth_getBlockByNumber')return {hash:opts.reorg&&blocks++?'0x'+'f'.repeat(64):hash} as T;
 if(method==='eth_getLogs')return logs as T;
 const data=(params[0] as any).data;
 if(opts.badBalance&&data.endsWith(recipient.slice(2)))throw Error('unavailable');
 return (data==='0x18160ddd'?'0x3e8':'0x64') as T;}};
 return {d,calls};
}
test('Supply Journey pins balances to checked block, deduplicates evidence and labels recent coverage',async()=>{
 const {d,calls}=fixture([log(),log(),log(curve,1)]);const r=await analyzeSupplyJourney(token,d);
 assert.equal(r.status,'WINDOW_COMPLETE');assert.equal(r.transfers.length,2);assert.equal(r.recipients.length,1);assert.equal(r.excluded,1);assert.equal(r.block,'3000');
 for(const call of calls.filter(c=>c.method==='eth_call'))assert.equal(call.params[1],'0xbb8');
 const text=renderSupplyJourney(r);assert.match(text,/Recent window, not launch history/);assert.match(text,/Recipient sales <b>Not assessed/);assert.match(text,/10.00%/);assert.doesNotMatch(text,/common owner|safe to buy|Confirmed sale/);
 assert.ok(supplyJourneyButtons(token).flat().every(b=>Buffer.byteLength(b.callback_data)<=64));assert.ok(renderSupplyJourney(r,'EVIDENCE').length<4096);
});
test('unsupported provenance triggers no RPC and no false supply verdict',async()=>{
 const {d,calls}=fixture();d.marker=async()=>({token,creator,curveAddress:curve,factory:recipient});
 const r=await analyzeSupplyJourney(token,d);assert.equal(r.status,'UNAVAILABLE');assert.equal(calls.length,0);assert.match(renderSupplyJourney(r),/No ownership or safety conclusion/);
});
test('missing balances and recipient caps remain partial, never fabricated zero',async()=>{
 const {d}=fixture([log()],{badBalance:true});const r=await analyzeSupplyJourney(token,d);assert.equal(r.status,'PARTIAL');assert.equal(r.recipients[0].balance,null);assert.match(renderSupplyJourney(r),/Combined current holdings <b>Unavailable/);
 const recipients=Array.from({length:7},(_,i)=>log('0x'+(i+1).toString(16).padStart(40,'0'),i));
 const capped=await analyzeSupplyJourney(token,fixture(recipients).d);assert.equal(capped.status,'PARTIAL');assert.equal(capped.recipients.length,6);
});
test('reorg, malformed and oversized logs cannot become complete coverage',async()=>{
 const r=await analyzeSupplyJourney(token,fixture([log()],{reorg:true}).d);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.transfers.length,0);
 for(const logs of [[{...log(),data:'oops'}],Array(201).fill(log()),[{...log(),removed:true}],[{...log(),blockNumber:'0x10000'}]])assert.throws(()=>decodeJourneyTransfers(logs,token,1000n,3000n));
});
test('no transfers means no movements observed in the window, not no history',async()=>{
 const r=await analyzeSupplyJourney(token,fixture([]).d);assert.equal(r.status,'WINDOW_COMPLETE');assert.equal(r.recipients.length,0);assert.match(renderSupplyJourney(r,'EVIDENCE'),/No creator transfers observed in this window/);
 assert.equal(supplyPercent(null,'100'),'Unavailable');assert.equal(supplyPercent('0','100'),'0.00%');
});
test('inconsistent combined balances cannot create holdings above total supply',async()=>{
 const {d}=fixture();const rpc=d.rpc;
 d.rpc=async<T>(method,params,signal)=>method==='eth_call'?((params[0] as any).data==='0x18160ddd'?'0x3e8':'0x3e7') as T:rpc<T>(method,params,signal);
 const r=await analyzeSupplyJourney(token,d);assert.equal(r.status,'UNAVAILABLE');assert.equal(r.holding,null);assert.equal(r.recipients.length,0);
});
test('independent reads overlap with at most two requests and unchanged request cap',async()=>{
 const logs=Array.from({length:6},(_,i)=>log('0x'+(i+1).toString(16).padStart(40,'0'),i));
 const {d,calls}=fixture(logs);const base=d.rpc;let active=0,max=0;
 d.rpc=async<T>(method,params,signal)=>{
  active++;max=Math.max(max,active);
  try{await new Promise(resolve=>setTimeout(resolve,5));return await base<T>(method,params,signal);}
  finally{active--;}
 };
 const r=await analyzeSupplyJourney(token,d);
 assert.equal(r.status,'WINDOW_COMPLETE');assert.equal(max,2);assert.equal(calls.length,13);
 assert.deepEqual(r.recipients.map(row=>row.address),logs.map(row=>'0x'+row.topics[2].slice(-40)));
});
