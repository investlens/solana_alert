import test from 'node:test';import assert from 'node:assert/strict';
import {createDexCoverageWorker,verifyDexCoverage,validCoverageCandidate,type DexCoverageCandidate,type DexCoverageCheckpoint} from '../src/services/ponsDexCoverage.js';
import type {PonsPublicContext} from '../src/chains/robinhood/ponsPublicContext.js';
const addr=(n:number)=>'0x'+n.toString(16).padStart(40,'0');
const candidate=(n=1):DexCoverageCandidate=>({token_address:addr(n),deployer_address:addr(2),factory_address:'0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e',curve_address:addr(3),protocol_version:'v2-current',block_number:'90200000'});
const pool=addr(4),now=Date.parse('2026-10-16T18:00:00Z');
const context:PonsPublicContext={name:'Test',symbol:'TEST',creator:addr(2),curveAddress:addr(3),poolId:pool,phase:1,venue:'dex',decimals:18,totalSupplyRaw:1n,fdvUsd:null,twitter:null,telegram:null};
const pair={chainId:'robinhood',baseToken:{address:addr(1)},pairAddress:pool,priceUsd:'0.01',liquidity:{usd:20000},marketCap:10000};
const verifier=(patch:Record<string,unknown>={})=>({context:async()=>context,graduated:async()=>true,v1Pool:async()=>pool,pairs:async()=>[pair],now:()=>now,...patch});
test('historical success requires exact census creator/curve, on-chain graduation, official mapped pool and usable market',async()=>{
 const proof=await verifyDexCoverage(candidate(),verifier());assert.equal(proof?.token,addr(1));assert.equal(proof?.pool,pool);assert.equal(proof?.observed_at,new Date(now).toISOString(),'never backdate present verification');
 for(const c of [{creator:addr(9)},{curveAddress:addr(9)},{venue:'curve'},{phase:0},{poolId:addr(9)}])assert.equal(await verifyDexCoverage(candidate(),verifier({context:async()=>({...context,...c})})),null);
 for(const graduated of [false,null])assert.equal(await verifyDexCoverage(candidate(),verifier({graduated:async()=>graduated})),null);
 for(const pairs of [[],[{...pair,chainId:'arc'}],[{...pair,baseToken:{address:addr(9)}}],[{...pair,liquidity:{usd:0}}]])assert.equal(await verifyDexCoverage(candidate(),verifier({pairs:async()=>pairs})),null);
 for(const c of [{factory_address:addr(9)},{block_number:'1'},{protocol_version:'v1-active'},{curve_address:null},{deployer_address:addr(0)}])assert.equal(validCoverageCandidate({...candidate(),...c}),false);
});
test('V1 uses its independent official mapping and never a V2 graduation shortcut',async()=>{
 const c={...candidate(),protocol_version:'v1-active',factory_address:'0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',curve_address:null};
 assert.equal((await verifyDexCoverage(c,verifier({graduated:async()=>{throw Error('must not run');}})))?.source,'PONS_V1_MAPPED_POOL');
 assert.equal(await verifyDexCoverage(c,verifier({v1Pool:async()=>addr(9)})),null);
});
test('backfill is two checks per minute, rotates, checkpoints before work and resumes after restart',async()=>{
 let clock=now,loads=0,checks=0;let saved:DexCoverageCheckpoint|null=null;const sequence:string[]=[];
 const deps={now:()=>clock,claim:async()=>true,restore:async()=>saved,checkpoint:async(v:DexCoverageCheckpoint)=>{saved=v;sequence.push('checkpoint');},
 load:async()=>{loads++;return [candidate(1),candidate(5),candidate(6)];},verify:async(c:DexCoverageCandidate)=>{checks++;sequence.push(c.token_address);return null;},save:async()=>{throw Error('No positive proof to save');},report:()=>{}};
 const worker=createDexCoverageWorker(deps);await Promise.all([worker.tick(),worker.tick()]);assert.equal(checks,2);assert.equal(loads,1);assert.equal(sequence[0],'checkpoint');
 await worker.tick();assert.equal(checks,2);clock+=60000;await worker.tick();assert.equal(checks,3);assert.equal(loads,1);
 const restarted=createDexCoverageWorker(deps);await restarted.tick();assert.equal(checks,3,'restored attempts avoid provider replay');
 clock+=3600000;await restarted.tick();assert.equal(checks,5);
});
test('unavailable shared budget, checkpoints or database defer optional research without verifying or writing',async()=>{
 let verified=0,writes=0;const deps={now:()=>now,claim:async()=>true,restore:async()=>null,checkpoint:async()=>{},load:async()=>[candidate()],verify:async()=>{verified++;return null;},save:async()=>{writes++;return 0;},report:()=>{}};
 for(const patch of [{claim:async()=>false},{restore:async()=>{throw Error('offline');}},{checkpoint:async()=>{throw Error('offline');}},{load:async()=>null}])await createDexCoverageWorker({...deps,...patch}).tick();
 assert.equal(verified,0);assert.equal(writes,0);
});
test('a valid proof writes only compact evidence and counts database acknowledgement separately',async()=>{
 const reports:Record<string,number|string>[]=[];const expected=(await verifyDexCoverage(candidate(),verifier()))!;
 const worker=createDexCoverageWorker({now:()=>now,claim:async()=>true,restore:async()=>null,checkpoint:async()=>{},load:async()=>[candidate()],verify:async()=>expected,save:async rows=>{assert.deepEqual(rows,[expected]);return 1;},report:s=>reports.push(s)});
 await worker.tick();assert.equal(reports[0].inserted,1);assert.equal(reports[0].verified,1);assert.equal(worker.stats().candidates,0);
});
