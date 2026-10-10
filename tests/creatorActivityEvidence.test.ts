import test from 'node:test';import assert from 'node:assert/strict';
import {parseCreatorOutflows} from '../src/services/creatorActivityEvidence.js';
import {readCreatorHoldingEvidence,parsePonsCreatorSales} from '../src/chains/robinhood/ponsPublicContext.js';
import {withOwnershipDisclosure} from '../src/ui/ownershipDisclosure.js';
const token='0x'+'1'.repeat(40),creator='0x'+'2'.repeat(40),other='0x'+'3'.repeat(40),tx='0x'+'4'.repeat(64);
const topic=(a:string)=>'0x'+a.slice(2).padStart(64,'0');
function log(to:string,index=0){return {address:token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(creator),topic(to)],transactionHash:tx,blockNumber:'0x64',logIndex:'0x'+index.toString(16),data:'0x'+(10n).toString(16).padStart(64,'0')};}
test('creator balance reads serialize and pin balance/supply to the same block',async()=>{
 let inflight=0,max=0;const blocks:unknown[]=[];
 const request=async(args:any)=>{inflight++;max=Math.max(max,inflight);await new Promise(r=>setTimeout(r,1));inflight--;if(args.method==='eth_blockNumber')return '0x64';blocks.push(args.params[1]);return blocks.length===1?'0x0a':'0x64';};
 const value=await readCreatorHoldingEvidence(token,creator,undefined,request as any);
 assert.equal(value?.percent,10);assert.equal(value?.block,'100');assert.equal(max,1);assert.deepEqual(blocks,['0x64','0x64']);
 assert.equal(await readCreatorHoldingEvidence(token,creator,'0x64',async()=> '0x' as any),null);
});
test('burn destinations and outgoing transfers stay separate; zero and self-transfer ignored',()=>{
 const burn=log('0x'+'0'.repeat(36)+'dead'),move=log(other,1),zero={...log(other,2),data:'0x'+'0'.repeat(64)};
 const result=parseCreatorOutflows([burn,burn,move,zero,log(creator,3)],token,creator,0n,100n)!;
 assert.equal(result.burns,1);assert.equal(result.outflows,1);assert.equal((result as any).sold,undefined);
 for(const altered of [{...move,address:other},{...move,removed:true},{...move,blockNumber:'0x65'},{...move,topics:[move.topics[0],topic(other),topic(other)]},{...move,data:'0x'}])assert.equal(parseCreatorOutflows([altered],token,creator,0n,100n),null);
 assert.equal(parseCreatorOutflows([],token,creator,0n,512n),null);
});
test('PONS sale reporting is exact creator, deduplicated and explicitly partial',()=>{
 const sale={id:tx+':1',txHash:tx,trader:creator,side:'sell',tokenAmount:10,timestamp:1};
 assert.equal(parsePonsCreatorSales([sale,sale,{...sale,trader:other}],creator,2000)?.count,1);
 assert.equal(parsePonsCreatorSales([{...sale,timestamp:3}],creator,2000),undefined);
 assert.equal(parsePonsCreatorSales([{...sale,id:'bad'}],creator,2000),undefined);
 const base={devPercent:0,top10Percent:null,top10Coverage:'UNAVAILABLE' as const};
 const plain=withOwnershipDisclosure('Research',base);assert.doesNotMatch(plain,/Creator sold|Creator burned/);assert.match(plain,/not established/);
 const card=withOwnershipDisclosure('Research',{...base,activity:{reportedSales:1,saleTx:tx,burns:1,outflows:2,fromBlock:'0',toBlock:'100',observedAt:2000}});
 assert.match(card,/PONS reported, recent page/);assert.match(card,/burn-address destinations/);assert.match(card,/may include sales/);assert.match(card,/partial history/);
});
