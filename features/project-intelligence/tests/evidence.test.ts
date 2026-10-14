import test from 'node:test';import assert from 'node:assert/strict';
import {directCreator,outgoingConnections,linkedHoldings,holderFindings,transferTopic} from '../evidence.js';
import {percentage,type Snapshot} from '../model.js';
const token='0x'+'a'.repeat(40),creator='0x'+'b'.repeat(40),wallet='0x'+'c'.repeat(40),tx='0x'+'d'.repeat(64);
const info={creator_address_hash:creator,creation_transaction_hash:tx},receipt={status:'0x1',to:null,contractAddress:token,from:creator,transactionHash:tx};
const topic=(s:string)=>'0x'+s.slice(2).padStart(64,'0');
const log={address:token,removed:false,topics:[transferTopic,topic(creator),topic(wallet)],data:'0x'+(10n).toString(16).padStart(64,'0'),transactionHash:tx,blockNumber:'0x10',logIndex:'0x0'};
const snapshot:Snapshot={chain:'robinhood',token,block:'0x10',observedAt:'2026-10-14T20:00:00Z',supply:1000n,balances:{[creator]:100n,[wallet]:200n}};
const source={source:'RPC',observedAt:snapshot.observedAt,block:snapshot.block};
test('direct creation requires matching mined receipt; factory calls and failed deployments do not establish developer',()=>{
 assert.equal(directCreator(token,info,receipt),creator);
 for(const patch of [{to:wallet},{status:'0x0'},{contractAddress:wallet},{from:wallet},{transactionHash:'0x'+'e'.repeat(64)}])assert.equal(directCreator(token,info,{...receipt,...patch}),null);
});
test('recipient graph validates exact token, sender, range and event identities; deduplicates logs and wallets',()=>{
 assert.deepEqual(outgoingConnections([log,log,{...log,logIndex:'0x1'}],token,creator,0n,16n),[{wallet,transactions:[tx]}]);
 for(const patch of [{removed:true},{address:wallet},{blockNumber:'0x11'},{data:'garbage'},{topics:[transferTopic,topic(wallet),topic(creator)]}])assert.throws(()=>outgoingConnections([{...log,...patch}],token,creator,0n,16n));
});
test('combined exposure counts distinct balances once and excludes contracts; no common ownership claim',()=>{
 const links=[{wallet,transactions:[tx]},{wallet,transactions:[tx]},{wallet:creator,transactions:[tx]}];
 const findings=linkedHoldings(snapshot,creator,links,new Set(),source);
 assert.equal(findings.find(f=>f.id==='connected-exposure')?.value,'300');
 assert.ok(findings.every(f=>f.quality==='OBSERVED_CONNECTION'));
 assert.equal(linkedHoldings(snapshot,creator,links,new Set([wallet]),source).length,0);
});
test('holder percentages use raw integer units, pinned balances and deduplication, not provider decimals or percentages',()=>{
 const findings=holderFindings({items:[{address:{hash:wallet},value:'999999'},{address:{hash:wallet}},{address:{hash:creator}}]},snapshot,new Set([creator]),source);
 assert.equal(findings.length,1);assert.equal(findings[0].value,'200');assert.match(findings[0].summary,/20.0000%/);
 assert.equal(percentage(0n,1000n),'0.0000%');assert.equal(percentage(1001n,1000n),null);assert.equal(percentage(1n,0n),null);
});

test('native funding connections require matching successful receipt and never establish wallet ownership',async()=>{
 const {confirmedFunding}=await import('../evidence.js');
 const transaction={hash:tx,from:creator,to:wallet,value:'0x1',blockNumber:'0x10'},fundingReceipt={transactionHash:tx,status:'0x1',from:creator,to:wallet};
 assert.deepEqual(confirmedFunding(creator,transaction,fundingReceipt,16n),{wallet,transactions:[tx]});
 assert.equal(confirmedFunding(creator,transaction,{...fundingReceipt,status:'0x0'},16n),null);
 assert.equal(confirmedFunding(creator,{...transaction,blockNumber:'0x11'},fundingReceipt,16n),null);
 assert.equal(confirmedFunding(creator,{...transaction,from:wallet},fundingReceipt,16n),null);
});
