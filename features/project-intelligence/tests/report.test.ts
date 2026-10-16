import test from 'node:test';import assert from 'node:assert/strict';
import {encodeAbiParameters,decodeFunctionData,parseAbiParameters,getContractAddress} from 'viem';
import {research} from '../report.js';import {abi,socialFindings,safeSocialUrl,type Reader} from '../providers.js';
const creator='0x'+'b'.repeat(40),token=getContractAddress({from:creator as `0x${string}`,nonce:0n}).toLowerCase(),wallet='0x'+'c'.repeat(40),tx='0x'+'d'.repeat(64),blockHash='0x'+'e'.repeat(64);
function fixture(mode='ok'):Reader{
 let blockReads=0;return {requests:()=>0,
  security:async()=>({creator_address:creator,is_honeypot:'0',is_mintable:'1'}),
  pairs:async()=>[{chainId:'arc',baseToken:{address:token},pairAddress:wallet,liquidity:{usd:999}},{chainId:'robinhood',baseToken:{address:token},pairAddress:'0x'+'1'.repeat(64),liquidity:{usd:1000},info:{socials:[{url:'https://x.com/example'}]}}],
  explorer:async(_chain,path)=>path.startsWith('addresses/'+token)?{hash:token,is_contract:true,creator_address_hash:creator,creation_transaction_hash:tx}:path.includes('/holders')?{items:[{address:{hash:creator}},{address:{hash:wallet}}]}:{items:[],next_page_params:{block_number:1}},
  rpc:async(_chain,method,params)=>{
   if(method==='eth_chainId')return mode==='wrong-chain'?'0x1':'0x1237';if(method==='eth_blockNumber')return '0x10';
   if(method==='eth_getBlockByNumber')return {number:params[0],transactions:[tx],hash:mode==='reorg'&&++blockReads>2?'0x'+'f'.repeat(64):blockHash};
   if(method==='eth_getCode')return '0x6001';
   if(method==='eth_getTransactionByHash')return {hash:tx,from:creator,to:null,nonce:'0x0',chainId:'0x1237',blockNumber:'0x1',blockHash};
   if(method==='eth_getTransactionReceipt')return {status:'0x1',to:mode==='factory'?wallet:null,contractAddress:token,from:creator,transactionHash:tx,blockNumber:'0x1',blockHash};
   if(method==='eth_getLogs')return [];
   const call=params[0] as any;assert.equal(params[1],'0x10');const decoded=decodeFunctionData({abi,data:call.data});
   if(decoded.functionName==='owner')return encodeAbiParameters(parseAbiParameters('address'),[creator as `0x${string}`]);
   if(decoded.functionName==='name'||decoded.functionName==='symbol')return encodeAbiParameters(parseAbiParameters('string'),['Example']);
   return encodeAbiParameters(parseAbiParameters('uint256'),[decoded.functionName==='totalSupply'?1000n:100n]);
  }};
}
test('report uses exact chain/token, independently checked developer, pinned balances and partial launch-history scope',async()=>{
 const report=await research('robinhood',token,{reader:fixture(),now:()=>1800000000000});
 assert.equal(report.findings.find(f=>f.id==='liquidity-usd')?.value,1000);
 assert.equal(report.findings.find(f=>f.id==='developer-holding')?.value,'100');assert.equal(report.coverage.identity,'AVAILABLE');
 assert.equal(report.coverage.launches,'PARTIAL');assert.match(report.findings.find(f=>f.id==='history-scope')!.limits!,/not lifetime/);
 assert.equal(report.coverage.selling,'UNAVAILABLE');assert.equal(report.findings.find(f=>f.id==='reported:is_mintable')?.quality,'SOURCE_REPORTED');
});
test('factory origin, wrong chain and reorg cannot create false verified developer findings',async()=>{
 for(const mode of ['factory','wrong-chain','reorg']){const report=await research('robinhood',token,{reader:fixture(mode),now:()=>1800000000000});assert.equal(report.findings.some(f=>f.id==='developer-holding'),false,mode);if(mode!=='factory')assert.equal(report.coverage.identity,'UNAVAILABLE');}
});
test('provider failure is unknown rather than zero holdings, no prior launches or a safe contract',async()=>{
 const fail=async()=>{throw Error('unavailable');};const report=await research('arc',token,{reader:{requests:()=>0,rpc:fail,explorer:fail,pairs:fail,security:fail}});
 assert.ok(report.findings.every(f=>f.quality==='UNVERIFIED'));assert.ok(Object.values(report.coverage).every(v=>v==='UNAVAILABLE'));
});
test('social samples reject account mismatches and future/duplicate posts; frequent posting does not establish legitimacy',()=>{
 assert.equal(safeSocialUrl('http://127.0.0.1'),null);assert.equal(safeSocialUrl('https://x.com.evil.invalid/name'),null);
 const at='2026-10-14T20:00:00Z';const raw={profileUrl:'https://x.com/example',posts:[{url:'https://x.com/example/status/1',text:'hello',publishedAt:at},{url:'https://x.com/example/status/1',text:'hello',publishedAt:at},{url:'https://x.com/other/status/2',text:'hello',publishedAt:at},{url:'https://x.com/example/status/3',text:'hello',publishedAt:'2027-01-01'}]};
 assert.equal(socialFindings(raw,raw.profileUrl,at).count,1);assert.match(socialFindings(raw,raw.profileUrl,at).limits,/not proof of legitimacy/);
 assert.throws(()=>socialFindings({...raw,profileUrl:'https://x.com/other'},raw.profileUrl,at));
});
test('optional holder sampling preserves the final canonicality read under a tight source budget',async()=>{
 const r=fixture();let remaining=30,calls=0;const rpc=r.rpc,explorer=r.explorer,security=r.security,pairs=r.pairs;
 const consume=()=>{calls++;if(--remaining<0)throw Error('Budget exhausted');};
 r.remaining=()=>remaining;
 r.rpc=async(...args)=>{consume();return rpc(...args);};r.security=async(...args)=>{consume();return security(...args);};r.pairs=async(...args)=>{consume();return pairs(...args);};
 r.explorer=async(...args)=>{consume();if(args[1].includes('/holders'))return {items:Array.from({length:8},(_,i)=>({address:{hash:'0x'+(i+1).toString(16).padStart(40,'0')}}))};return explorer(...args);};
 const result=await research('robinhood',token,{reader:r,now:()=>1800000000000});
 assert.equal(result.coverage.identity,'AVAILABLE');assert.equal(result.findings.find(f=>f.id==='developer-holding')?.quality,'VERIFIED');assert.ok(calls<=30);assert.ok(remaining>=8);
});
