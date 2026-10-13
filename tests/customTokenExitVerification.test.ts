import test from 'node:test';import assert from 'node:assert/strict';
import {decodeAbiParameters,decodeFunctionData,encodeAbiParameters,parseAbiParameters,parseAbi,keccak256,type Address} from 'viem';
import {createCustomExitVerifier,resolvePlainV4Key,customPoolRisk,roundTripLoss,observedLpStatus,EXIT_CHAIN_CONFIG} from '../src/services/customTokenExitVerification.js';
const token=('0x'+'a'.repeat(40)) as Address,quote=EXIT_CHAIN_CONFIG.robinhood.quote;
const currencies=[token.toLowerCase(),quote.toLowerCase()].sort() as Address[];
const pair=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[currencies[0],currencies[1],3000,60,'0x0000000000000000000000000000000000000000']));
const encoded=(n:bigint)=>encodeAbiParameters(parseAbiParameters('uint256'),[n]);
const erc20=parseAbi(['function balanceOf(address) view returns (uint256)','function deposit() payable','function approve(address,uint256) returns (bool)']);
function fixture(mode='success'){
 const requests:{method:string;params:any[]}[]=[];let wallets=0;const now=()=>2_000_000_000_000;
 const verify=createCustomExitVerifier({now,wallet:()=>('0x'+(++wallets).toString(16).padStart(40,'0')) as Address,
  pairs:async()=>[{chainId:'robinhood',baseToken:{address:token},quoteToken:{address:quote},pairAddress:pair,dexId:'uniswap',liquidity:{usd:100000}}],
  rpc:async(chain,method,params)=>{
   requests.push({method,params});if(method==='eth_chainId')return mode==='wrong-chain'?'0x1':chain==='arc'?'0x13b2':'0x1237';
   if(method==='eth_blockNumber')return '0x123456';if(mode==='unsupported')throw Error('unsupported');
   const spec=(params[0] as any).blockStateCalls[0],calls=spec.calls;
   assert.equal(params[1],'0x123456','both phases are pinned to the same block');
   const wallet=calls[0].from;assert.ok(calls.every((c:any)=>c.from===wallet),'all approvals, buy and sell originate from the same wallet');
   assert.deepEqual(Object.keys(spec.stateOverrides),[wallet],'no token, pool or router state overrides');
   assert.deepEqual(Object.keys(spec.stateOverrides[wallet]),['balance']);
   assert.equal(decodeFunctionData({abi:erc20,data:calls[2].data}).functionName,'deposit');
   const routed=decodeFunctionData({abi:parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']),data:calls[5].data});
   const [actions,inputs]=decodeAbiParameters(parseAbiParameters('bytes,bytes[]'),routed.args![1][0]);
   assert.equal(actions,'0x060c0f');
   const [swap]=decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),inputs[0]);
   assert.equal(swap.minHopPriceX36,0n);assert.equal(swap.hookData,'0x');
   assert.equal(keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[swap.poolKey.currency0,swap.poolKey.currency1,swap.poolKey.fee,swap.poolKey.tickSpacing,swap.poolKey.hooks])),pair);
   assert.ok(calls.reduce((n:bigint,c:any)=>n+BigInt(c.gas),0n)<=6_000_000n,'simulation stays within bounded block gas');
   const input=BigInt(calls[2].value),output=mode==='99-loss'?input/100n:input*995n/1000n;
   return [{calls:calls.map((c:any,i:number)=>({status:mode==='revert'&&i===10?'0x0':'0x1',returnData:[0,1,6,7,11,12].includes(i)?encoded(i===6?1000n:i===11?(mode==='zero'?0n:output):i===12&&mode==='partial'?1n:0n):'0x'}))}];
  }});
 return {verify,requests,get wallets(){return wallets;}};
}
test('full same-wallet round trip at three sizes, cached without further provider calls',async()=>{
 const f=fixture();const r=await f.verify({chain:'robinhood',token});
 assert.equal(r.allowed,true);assert.equal(r.pairId,pair);assert.equal(r.maxLossPercent,0.5);assert.equal(f.wallets,3);
 assert.equal(f.requests.filter(r=>r.method==='eth_simulateV1').length,6);
 const count=f.requests.length;assert.equal((await f.verify({chain:'robinhood',token})).allowed,true);assert.equal(f.requests.length,count);
});
test('provider flags or quotes never substitute for execution; restrictions, unsupported RPC, zero or partial exits block',async()=>{
 for(const mode of ['wrong-chain','unsupported','revert','99-loss','zero','partial']){
  const r=await fixture(mode).verify({chain:'robinhood',token,security:{is_honeypot:'0',cannot_sell_all:'0'}});assert.equal(r.allowed,false,mode);
 }
 assert.equal((await fixture().verify({chain:'robinhood',token,security:{is_honeypot:'1'}})).allowed,false);
});
test('exact pool hash, token, fee and quote identity required',async()=>{
 assert.ok(resolvePlainV4Key(token,quote,pair,3000));assert.equal(resolvePlainV4Key(token,quote,pair,10000),null);
 assert.equal(resolvePlainV4Key(quote,quote,pair,3000),null);
 assert.equal((await fixture().verify({chain:'robinhood',token,pairId:'0x'+'f'.repeat(64)})).allowed,false);
});
test('fees are scoped to the checked pool; LP status does not prove an exit',()=>{
 const dangerous='0x'+'f'.repeat(64);
 const evidence={dex:[{pair:dangerous,liquidity:'7.5',pool_fee:'0.85'},{pair,liquidity:'100000',pool_fee:'0.003'}]};
 assert.equal(customPoolRisk(evidence),null);
 assert.match(customPoolRisk(evidence,dangerous)!,/Selected pool/);
 assert.equal(customPoolRisk(evidence,pair),null);
 assert.match(customPoolRisk({...evidence,is_honeypot:'1'},pair)!,/honeypot/);
 assert.equal(customPoolRisk({dex:[{liquidity:'100000',pool_fee:'0.003'}]}),null);
 assert.equal(observedLpStatus(undefined),'UNKNOWN');
 assert.equal(observedLpStatus({lp_holders:[{address:token,percent:'1',is_locked:'0'}]}),'UNLOCKED');
 assert.equal(roundTripLoss(10000n,90n),99.1);
});
test('a dust high-fee pool does not block a verified zero-fee route, but the selected high-fee route blocks',async()=>{
 const security={dex:[{pair:'0x'+'f'.repeat(64),liquidity:'2',pool_fee:'0.85'},{pair,liquidity:'100000',pool_fee:'0.003'}]};
 assert.equal((await fixture().verify({chain:'robinhood',token,security})).allowed,true);
 const f=fixture();const result=await f.verify({chain:'robinhood',token,pairId:pair,security:{dex:[{pair,liquidity:'100000',pool_fee:'0.85'}]}});
 assert.equal(result.allowed,false);assert.equal(f.requests.length,0);
});
test('ARC unsupported simulation is withheld, not turned into a warning-only alert',async()=>{
 const f=fixture('unsupported');assert.equal((await f.verify({chain:'arc',token})).allowed,false);
});
test('concurrent checks for a token coalesce without duplicate simulation',async()=>{
 const f=fixture();const results=await Promise.all([f.verify({chain:'robinhood',token}),f.verify({chain:'robinhood',token})]);
 assert.ok(results.every(r=>r.allowed));assert.equal(f.wallets,3);
});
