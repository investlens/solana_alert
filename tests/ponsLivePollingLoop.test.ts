import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, parseAbiParameters } from 'viem';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import { pollPonsLiveLaunchesOnce } from '../src/chains/robinhood/ponsLiveLaunchDetector.js';
import { parsePonsLiveDevMode, runPonsLivePollingLoop, type PonsLiveSignal, type PonsLiveSignalSource } from '../src/chains/robinhood/ponsLivePollingLoop.js';

class Signals implements PonsLiveSignalSource {
  private listeners = new Map<PonsLiveSignal, Set<() => void>>();
  on(signal:PonsLiveSignal,listener:()=>void){const set=this.listeners.get(signal)??new Set();set.add(listener);this.listeners.set(signal,set)}
  off(signal:PonsLiveSignal,listener:()=>void){this.listeners.get(signal)?.delete(listener)}
  emit(signal:PonsLiveSignal){for(const listener of this.listeners.get(signal)??[])listener()}
}

test('continuous loop performs repeated polls and transient failure does not kill it',async()=>{const signals=new Signals();const logs:string[]=[];let polls=0,sleeps=0;await runPonsLivePollingLoop({signalSource:signals,pollIntervalMs:100,log:line=>logs.push(line),poll:async()=>{polls++;if(polls===1)throw new TypeError('fetch failed');return{detected:0,handled:0,duplicates:0}},sleep:async()=>{sleeps++;if(sleeps===2)signals.emit('SIGINT')}});assert.equal(polls,2);assert.equal(sleeps,2);assert.ok(logs.some(line=>line.includes('retrying next cycle')));assert.deepEqual(logs.slice(-2),['[PonsLive] shutdown requested','[PonsLive] stopped'])});

test('continuous detector checkpoint prevents the same launch from being handled again',async()=>{const signals=new Signals();const factory=getPonsFactoryDeployments().find(x=>x.id==='v2-current')!;const event=parseAbiItem(factory.tokenLaunchedEvent);const token='0x1111111111111111111111111111111111111111';const log={topics:encodeEventTopics({abi:[event],eventName:'TokenLaunched',args:{token,curve:'0x2222222222222222222222222222222222222222',deployer:'0x3333333333333333333333333333333333333333'}}),data:encodeAbiParameters(parseAbiParameters('address,uint256,uint256'),['0x4444444444444444444444444444444444444444',1n,2n]),blockNumber:20n,transactionHash:`0x${'ab'.repeat(32)}` as const,logIndex:1};let checkpoint:bigint|null=null,handled=0,polls=0;const poll=()=>pollPonsLiveLaunchesOnce({getBlockNumber:async()=>20n,getLogs:async()=>[log],getBlock:async()=>({timestamp:1_700_000_000n})} as never,{getLiveCheckpoint:async()=>checkpoint,persistLaunches:async()=>{},setLiveCheckpoint:async(_factory,block)=>{checkpoint=block}},async()=>{handled++},{factories:[factory],log:()=>{}});await runPonsLivePollingLoop({signalSource:signals,pollIntervalMs:100,log:()=>{},poll:async()=>{polls++;const result=await poll();if(polls===2)signals.emit('SIGTERM');return result},sleep:async()=>{}});assert.equal(polls,2);assert.equal(handled,1);assert.equal(checkpoint,20n)});

test('SIGINT and SIGTERM both stop cleanly after the current poll',async()=>{for(const signal of ['SIGINT','SIGTERM'] as const){const signals=new Signals();const logs:string[]=[];let polls=0;await runPonsLivePollingLoop({signalSource:signals,log:line=>logs.push(line),poll:async()=>{polls++;signals.emit(signal);return{detected:0,handled:0,duplicates:0}},sleep:async()=>{throw new Error('must not sleep after shutdown')}});assert.equal(polls,1);assert.ok(logs.includes('[PonsLive] stopped'))}});

test('CLI mode parsing preserves read-only once and replay modes while defaulting to continuous',()=>{assert.deepEqual(parsePonsLiveDevMode([]),{kind:'CONTINUOUS'});assert.deepEqual(parsePonsLiveDevMode(['--once']),{kind:'ONCE'});assert.deepEqual(parsePonsLiveDevMode(['--replay-token=0xabc']),{kind:'REPLAY',tokenAddress:'0xabc'});assert.throws(()=>parsePonsLiveDevMode(['--once','--replay-token=0xabc']))});

test('continuous loop exposes polling only and has no real-trading capability',()=>{const options:Parameters<typeof runPonsLivePollingLoop>[0]={poll:async()=>({detected:0,handled:0,duplicates:0})};assert.deepEqual(Object.keys(options),['poll']);assert.equal('trade' in options,false)});
