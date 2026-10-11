import test from 'node:test';import assert from 'node:assert/strict';
import {boundedBackground} from '../src/services/boundedBackground.js';
import {winnerPost} from '../src/services/winnerPublisher.js';
import {holderChallenge,verifyTokenHolder} from '../src/services/tokenHolderAccess.js';
const token=('0x'+'a'.repeat(40)) as `0x${string}`;
test('background scans return immediately and bound duplicate/concurrent work',async()=>{
 const jobs=boundedBackground(1);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 assert.equal(jobs.start('a',()=>gate,()=>{}),true);assert.equal(jobs.start('a',async()=>{},()=>{}),false);assert.equal(jobs.start('b',async()=>{},()=>{}),false);
 release();await new Promise(r=>setImmediate(r));assert.equal(jobs.size,0);
});
test('winner copy requires comparable verified milestone and preserves evidence',()=>{
 const row={chain:'robinhood',token,feed:'BOOST',pair_id:token,price_unit:'USD',baseline_price:1,started_at:'2026-10-11T12:00:00Z',checkpoint:0,retried:false,lease:''};
 const sample={status:'MEASURED' as const,price:5,mc:null,liquidity:2000,at:'2026-10-11T12:15:00Z',symbol:'TEST'};
 assert.match(winnerPost(row,sample,'https://alphaos.example')!.text,/reached 5x/);assert.match(winnerPost(row,sample,'https://alphaos.example')!.text,/not profit/);
 assert.equal(winnerPost({...row,price_unit:'ETH_RESERVE_RATIO'},sample,'https://alphaos.example'),null);
 assert.equal(winnerPost(row,{...sample,at:row.started_at},'https://alphaos.example'),null);
});
test('holder verification fails closed for disabled, expiry, wrong chain, bad signature or low balance',async()=>{
 const now=Date.now(),challenge=holderChallenge('123',token,999,now),policy={enabled:true,chainId:999,token,decimals:0,minimum:'100'};
 const deps={chainId:async()=>999,balance:async()=>100n,verify:async()=>true};
 assert.equal(await verifyTokenHolder(challenge,'0x12',policy,deps,now),true);
 assert.equal(await verifyTokenHolder(challenge,'0x12',{...policy,enabled:false},deps,now),false);
 assert.equal(await verifyTokenHolder(challenge,'0x12',policy,deps,now+300000),false);
 assert.equal(await verifyTokenHolder(challenge,'0x12',policy,{...deps,chainId:async()=>1},now),false);
 assert.equal(await verifyTokenHolder(challenge,'0x12',policy,{...deps,verify:async()=>false},now),false);
 assert.equal(await verifyTokenHolder(challenge,'0x12',policy,{...deps,balance:async()=>99n},now),false);
});
