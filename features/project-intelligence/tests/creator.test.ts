import test from 'node:test';import assert from 'node:assert/strict';
import {encodeAbiParameters,encodeEventTopics,parseAbi,getContractAddress} from 'viem';
import {verifiedCreator} from '../creator.js';import type {Reader} from '../providers.js';
import {getPonsFactoryDeployments} from '../../../src/chains/robinhood/ponsContracts.js';
const creator='0x'+'b'.repeat(40),token=getContractAddress({from:creator as `0x${string}`,nonce:0n}).toLowerCase(),transaction='0x'+'d'.repeat(64),blockHash='0x'+'e'.repeat(64);
function fixture(patch:any={}){
 const factory=getPonsFactoryDeployments()[3],number='0x'+(factory.startBlock!+100n).toString(16),head='0x'+(factory.startBlock!+112n).toString(16);
 const tx={hash:transaction,from:creator,to:null,nonce:'0x0',chainId:'0x1237',blockNumber:number,blockHash,...patch.tx};
 const receipt={status:'0x1',to:null,from:creator,contractAddress:token,transactionHash:transaction,blockNumber:number,blockHash,logs:[],...patch.receipt};
 const block={number,hash:blockHash,transactions:[transaction],...patch.block};
 const reader={rpc:async(_c:string,m:string)=>m==='eth_getTransactionReceipt'?receipt:m==='eth_getTransactionByHash'?tx:m==='eth_getBlockByNumber'?block:'0x6001'} as unknown as Reader;
 const info={hash:token,is_contract:true,creator_address_hash:creator,creation_transaction_hash:transaction};
 return {reader,info,head,receipt,tx,block,factory,number};
}
test('direct identity requires canonical sender/nonce proof and twelve confirmations',async()=>{
 const f=fixture();assert.equal((await verifiedCreator(f.reader,'robinhood',token,f.info,f.head))?.creator,creator);
 for(const patch of [{tx:{nonce:'0x1'}},{tx:{chainId:'0x1'}},{block:{transactions:[]}},{block:{hash:'0x'+'f'.repeat(64)}},{receipt:{status:'0x0'}},{tx:{to:creator}}]){
  const f=fixture(patch);assert.equal(await verifiedCreator(f.reader,'robinhood',token,f.info,f.head),null);
 }
 assert.equal(await verifiedCreator(f.reader,'robinhood',token,f.info,f.number),null);
});
test('PONS creator is decoded from approved exact-token event, never the factory caller',async()=>{
 const f=fixture(),abi=parseAbi([f.factory.tokenLaunchedEvent]);
 const log={address:f.factory.address,blockNumber:f.number,blockHash,transactionHash:transaction,removed:false,
 topics:encodeEventTopics({abi,eventName:'TokenLaunched',args:{token,curve:'0x'+'c'.repeat(40),deployer:creator}} as any),
 data:encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'uint256'}],['0x'+'1'.repeat(40) as `0x${string}`,1n,1n])};
 f.receipt.to=f.factory.address as any;f.receipt.logs=[log] as any;f.tx.to=f.factory.address as any;
 assert.equal((await verifiedCreator(f.reader,'robinhood',token,f.info,f.head))?.source,'PONS_FACTORY_EVENT');
 assert.equal(await verifiedCreator(f.reader,'arc',token,f.info,f.head),null);
 const conflict={...log,topics:encodeEventTopics({abi,eventName:'TokenLaunched',args:{token,curve:'0x'+'c'.repeat(40),deployer:'0x'+'a'.repeat(40)}} as any)};
 f.receipt.logs=[log,conflict] as any;assert.equal(await verifiedCreator(f.reader,'robinhood',token,f.info,f.head),null);
 for(const patch of [{address:creator},{removed:true},{blockHash:'0x'+'f'.repeat(64)},{transactionHash:'0x'+'a'.repeat(64)}]){
  f.receipt.logs=[{...log,...patch}] as any;assert.equal(await verifiedCreator(f.reader,'robinhood',token,f.info,f.head),null);
 }
});
