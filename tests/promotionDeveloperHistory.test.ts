import test from 'node:test';import assert from 'node:assert/strict';
import {assessDeveloperHistory,developerHistoryNote,createDeveloperHistoryReader,type CensusLaunch} from '../src/services/promotionDeveloperHistory.js';
import {getPonsFactoryDeployments} from '../src/chains/robinhood/ponsContracts.js';
import {buildPromotionEventCard} from '../src/ui/promotionEventCard.js';
const token='0x'+'a'.repeat(40),creator='0x'+'b'.repeat(40);
const row=(n:number,block=10,index=0):CensusLaunch=>({chain:'robinhood',protocol:'pons',token_address:'0x'+n.toString(16).padStart(40,'0'),deployer_address:creator,factory_address:getPonsFactoryDeployments()[0].address,transaction_hash:'0x'+n.toString(16).padStart(64,'0'),block_number:block,log_index:index});
const current={...row(1,20,5),token_address:token};
test('counts unique earlier tokens by exact recorded deployer; current/future events do not count',()=>{
 const result=assessDeveloperHistory(token,current,[row(2),row(2),row(3,20,4),row(4,20,6),row(5,21),current]);
 assert.equal(result.prior,2);assert.match(developerHistoryNote(result),/Repeat deployer/);assert.match(developerHistoryNote(result),/identity and intent unverified/);
});
test('unapproved factory, mismatched developer, wrong chain and missing census cannot create a warning',()=>{
 for(const rows of [[{...row(2),deployer_address:token}],[{...row(2),chain:'arc'}],[{...row(2),factory_address:token}],[{...row(2),transaction_hash:'bad'}]])assert.equal(assessDeveloperHistory(token,current,rows).status,'UNVERIFIED');
 assert.equal(assessDeveloperHistory(token,null,[]).status,'UNVERIFIED');assert.match(developerHistoryNote(),/Unverified/);
 assert.match(developerHistoryNote(assessDeveloperHistory(token,current,[])),/other wallets\/chains unverified/);
});
test('bounded samples explicitly disclose a lower bound',()=>{
 const result=assessDeveloperHistory(token,{...current,block_number:200},Array.from({length:101},(_,i)=>row(i+2,i)));
 assert.match(developerHistoryNote(result),/at least 101/);
});
test('lookups coalesce/cache, errors back off and render never performs I/O',async()=>{
 let calls=0,time=100000;const reader=createDeveloperHistoryReader(async()=>{calls++;return {current,rows:[row(2)]};},()=>time);
 assert.equal(reader.peek(token),null);await Promise.all([reader.read(token),reader.read(token)]);assert.equal(calls,1);await reader.read(token);assert.equal(calls,1);
 for(const kind of ['BOOST','DEX_PAID'] as const){const c=buildPromotionEventCard({kind,token,launchType:'PONS',stats:null,securityNote:null,buttons:[],text:'Boost 30 total (+30)',developerHistoryNote:developerHistoryNote(reader.peek(token))});assert.match(c.text,/1 earlier indexed PONS token/);assert.match(c.text,/Verified PONS origin/);}
 let failed=0;const broken=createDeveloperHistoryReader(async()=>{failed++;throw Error('down');},()=>time);assert.equal((await broken.read(token)).status,'UNVERIFIED');time+=16000;await broken.read('0x'+'d'.repeat(40));assert.equal(failed,1);
});

test('conflicting token claims for the same census event remain unverified',()=>{
 const a=row(2),b={...row(3),transaction_hash:a.transaction_hash};
 assert.equal(assessDeveloperHistory(token,current,[a,b]).status,'UNVERIFIED');
});
