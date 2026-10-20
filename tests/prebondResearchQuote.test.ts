import test from 'node:test';import assert from 'node:assert/strict';
import {decodeFunctionData,encodeFunctionResult,parseAbi} from 'viem';
import {readPrebondResearchQuote} from '../src/services/prebondResearchQuote.js';
const abi=parseAbi(['function token() view returns(address)','function pairToken() view returns(address)','function getReserves() view returns(uint256,uint256)','function graduated() view returns(bool)']);
const token='0x'+'1'.repeat(40),curve='0x'+'2'.repeat(40),hash='0x'+'a'.repeat(64),now=1_000_000;
function provider(overrides:Record<string,any>={}){
 const calls:any[]=[];
 const rpc=async(a:any)=>{calls.push(a);if(a.method==='eth_blockNumber')return '0x66';if(a.method==='eth_getBlockByNumber')return {number:'0x64',hash,timestamp:'0x3e7',...overrides.header};
  const name=decodeFunctionData({abi,data:a.params[0].data}).functionName;
  const results:any={token,pairToken:'0x'+'0'.repeat(40),graduated:false,getReserves:[100n,200n],...overrides};
  if(results[name] instanceof Error)throw results[name];
  return encodeFunctionResult({abi,functionName:name,result:results[name]});};
 return {rpc,calls};
}
test('a native curve observation pins every read to the same confirmed block',async()=>{
 const p=provider();const s=await readPrebondResearchQuote(token,curve,p.rpc,()=>now);
 assert.deepEqual(s,{status:'MEASURED',price:0.5,at:new Date(999000).toISOString(),block:'100',block_hash:hash});
 assert.equal(p.calls.length,6);assert.ok(p.calls.filter(c=>c.method==='eth_call').every(c=>c.params[1]==='0x64'));
});
test('graduation stops the cohort; non-native quotes and mismatched token identities cannot measure',async()=>{
 const graduated=provider({graduated:true});const s=await readPrebondResearchQuote(token,curve,graduated.rpc,()=>now);
 assert.equal(s.status,'GRADUATED');assert.equal(s.price,null);assert.equal(graduated.calls.length,5);
 for(const changes of [{token:curve},{pairToken:token},{getReserves:[0n,1n]},{getReserves:[1n,0n]},{graduated:Error('RPC')}]){
  const p=provider(changes);assert.equal((await readPrebondResearchQuote(token,curve,p.rpc,()=>now)).status,'UNAVAILABLE');
 }
});
test('stale, future and mismatched block evidence cannot masquerade as a current quote',async()=>{
 for(const header of [{timestamp:'0x1'},{timestamp:'0x3e9'},{number:'0x63'},{hash:'bad'}]){
  const p=provider({header});assert.equal((await readPrebondResearchQuote(token,curve,p.rpc,()=>now)).status,'UNAVAILABLE');
  assert.equal(p.calls.length,2);
 }
 const p=provider();let checks=0;
 const s=await readPrebondResearchQuote(token,curve,p.rpc,()=>now,()=>{if(++checks>2)throw Error('aborted');});
 assert.equal(s.status,'UNAVAILABLE');assert.equal(p.calls.length,2);
});
