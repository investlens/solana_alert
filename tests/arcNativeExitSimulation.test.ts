import test from 'node:test';import assert from 'node:assert/strict';
import {createArcNativeExitSimulator,arcNativeRoute} from '../src/chains/arc/nativeExitSimulation.js';
import {resolveArcObservedPoolKey} from '../src/chains/arc/observedSelling.js';
import {decodeFunctionData,decodeAbiParameters,parseAbi,parseAbiParameters,toHex} from 'viem';
const token='0xd3626ef8104bbd6136d8b4d72527e2cb8dc16777',pool='0x1ec0e072aec80985ef7202834630a780b16019cbb645fa87acd163e06c0535af',zero='0x0000000000000000000000000000000000000000';
const metadata={fee:2500,tickSpacing:50,hooks:zero,quoteAsset:zero};
const balance=(n:bigint)=>({status:'0x1',returnData:toHex(n,{size:32})});
function harness(failure?:'revert'|'residual'|'loss'|'partial'){
 let calls=0;const snapshots:string[]=[];
 const verify=createArcNativeExitSimulator({now:()=>1000,rpc:async(method,params)=>{
  if(method==='eth_chainId')return '0x13b2';if(method==='eth_blockNumber')return '0x100';
  calls++;const input=params[0] as any,block=input.blockStateCalls[0],override=Object.values(block.stateOverrides)[0] as any;
  assert.deepEqual(Object.keys(override),['balance']);assert.equal(Object.keys(block.stateOverrides).length,1);assert.equal(input.validation,false);
  snapshots.push(params[1] as string);const amount=BigInt(override.balance)/10n**12n,tokens=123456789n;
  const rows=Array.from({length:block.calls.length},()=>balance(0n));rows[1]=balance(amount);rows[3]=balance(tokens);
  assert.ok(block.calls.reduce((sum:number,c:any)=>sum+Number(BigInt(c.gas)),0)<=6_000_000);
  if(block.calls.length===10){rows[8]=balance(failure==='loss'?amount/2n:amount*995n/1000n);rows[9]=balance(failure==='residual'?1n:0n);}
  if(failure==='revert')rows[2]={status:'0x0',returnData:'0x'};if(failure==='partial')rows.pop();return [{calls:rows}];
 }});return {verify,count:()=>calls,snapshots};
}
test('three-size native buy/full exit uses one snapshot and only native test-wallet overrides',async()=>{
 const h=harness(),r=await h.verify(token,pool,metadata);assert.equal(r.allowed,true);assert.equal(h.count(),6);assert.equal(new Set(h.snapshots).size,1);assert.equal(r.lpStatus,'UNKNOWN');assert.match(r.reason,/\$10\/\$100\/\$500/);await h.verify(token,pool,metadata);assert.equal(h.count(),6);
});
test('revert, residual balance, excessive loss and incomplete results cannot pass',async()=>{
 for(const failure of ['revert','residual','loss','partial'] as const)assert.equal((await harness(failure).verify(token,pool,metadata)).allowed,false);
 assert.match((await harness('revert').verify(token,pool,metadata)).reason,/Confirmed.*reverted/);
});
test('unsupported hooks and mismatched metadata never invoke RPC',async()=>{const h=harness();assert.equal((await h.verify(token,pool,{...metadata,hooks:'0x'+'a'.repeat(40)})).allowed,false);assert.equal(h.count(),0);});
test('ARC router ABI includes the minimum hop price field, not hook offset in its place',()=>{
 const key=resolveArcObservedPoolKey(token,zero,pool,metadata)!;const data=arcNativeRoute(key,zero,token,10n**18n,1000n);
 const decoded=decodeFunctionData({abi:parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']),data});
 const [,inputs]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),decoded.args[1][0]);
 const [swap]=decodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),inputs[0]);assert.equal(swap[4],0n);assert.equal(swap[5],'0x');
});
