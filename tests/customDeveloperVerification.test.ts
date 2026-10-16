import test from 'node:test';
import assert from 'node:assert/strict';
import {getContractAddress} from 'viem';
import {deploymentHint,verifyDirectDeployment,readDirectDeployment} from '../src/services/customDeveloperVerification.js';
import {createCustomDeveloperWorker} from '../src/services/customDeveloperWorker.js';

const creator='0x'+'2'.repeat(40) as `0x${string}`;
const token=getContractAddress({from:creator,nonce:0n}).toLowerCase();
const txHash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64);
const fixture=()=>({chain:'robinhood' as const,token,hint:{creator,hash:txHash},chainId:'0x1237',
 tx:{hash:txHash,from:creator,to:null,chainId:'0x1237',nonce:'0x0',blockNumber:'0x10',blockHash},
 receipt:{transactionHash:txHash,from:creator,to:null,status:'0x1',contractAddress:token,blockNumber:'0x10',blockHash},
 block:{number:'0x10',hash:blockHash,transactions:[txHash]},head:'0x20',code:'0x60006000'});
const metadata={hash:token,is_contract:true,creator_address_hash:creator,creation_transaction_hash:txHash};
test('direct receipt, canonical block, chain, confirmations and CREATE address all agree',()=>{
 assert.equal(verifyDirectDeployment(fixture())?.creator,creator);
 const arc={...fixture(),chain:'arc' as const,chainId:'0x13b2',tx:{...fixture().tx,chainId:'0x13b2'}};
 assert.equal(verifyDirectDeployment(arc)?.chain,'arc');
 assert.deepEqual(deploymentHint(token,metadata),{creator,hash:txHash});
});
test('explorer wallet labels and mismatched token metadata never establish identity',()=>{
 for(const payload of [{...metadata,hash:creator},{...metadata,is_contract:false},{...metadata,creator_address_hash:'0x'+'0'.repeat(40)},{...metadata,creation_transaction_hash:null}])assert.equal(deploymentHint(token,payload),null);
});
test('factory callers, failed receipts, wrong chain, reorgs, young blocks and wrong CREATE nonce are rejected',()=>{
 const f=fixture();
 const bad=[{...f,chainId:'0x1'},{...f,tx:{...f.tx,to:creator}}, {...f,receipt:{...f.receipt,contractAddress:null}},
  {...f,receipt:{...f.receipt,status:'0x0'}},{...f,receipt:{...f.receipt,from:token}},
  {...f,receipt:{...f.receipt,transactionHash:blockHash}},{...f,tx:{...f.tx,chainId:'0x1'}},
  {...f,tx:{...f.tx,nonce:'0x1'}},{...f,tx:{...f.tx,blockNumber:'0x11'}},
  {...f,block:{...f.block,hash:txHash}},{...f,block:{...f.block,transactions:[]}},
  {...f,head:'0x11'},{...f,code:'0x'},{...f,code:'0x6'},{...f,receipt:{...f.receipt,blockHash:null}}];
 for(const value of bad)assert.equal(verifyDirectDeployment(value),null);
});
test('bounded reader uses six exact RPC reads without logs, tracing or history pagination',async()=>{
 const f=fixture();const calls:string[]=[];
 const values:Record<string,unknown>={eth_chainId:f.chainId,eth_getTransactionByHash:f.tx,eth_getTransactionReceipt:f.receipt,eth_getBlockByNumber:f.block,eth_blockNumber:f.head,eth_getCode:f.code};
 const proof=await readDirectDeployment('robinhood',token,{explorer:async()=>metadata,rpc:async(method)=>{calls.push(method);return values[method];}});
 assert.equal(proof?.creator,creator);assert.equal(calls.length,6);assert.equal(calls.some(c=>/Logs|trace|filter/i.test(c)),false);
 calls.length=0;
 assert.equal(await readDirectDeployment('robinhood',token,{explorer:async()=>metadata,rpc:async(method)=>{calls.push(method);return method==='eth_chainId'?f.chainId:{...f.tx,to:creator};}}),null);
 assert.equal(calls.length,2);
});
test('worker coalesces requests, respects ten-minute budget and backs off errors for an hour',async()=>{
 let now=1,claims=0,finishes=0,release!:()=>void;
 const claim={chain:'arc' as const,token,lease:'lease'};
 const worker=createCustomDeveloperWorker({now:()=>now,claim:async()=>{claims++;return claim;},verify:async()=>{await new Promise<void>(r=>release=r);return null;},finish:async()=>{finishes++;return {};}});
 const first=worker();await Promise.resolve();await worker();assert.equal(claims,1);release();await first;
 await worker();assert.equal(claims,1);assert.equal(finishes,1);
 now+=10*60000;const second=worker();await Promise.resolve();release();await second;assert.equal(claims,2);
 let failures=0;
 const failing=createCustomDeveloperWorker({now:()=>now,claim:async()=>claim,verify:async()=>{failures++;throw Error('403');},finish:async()=>({})});
 await failing();now+=10*60000;await failing();assert.equal(failures,1);now+=50*60000;await failing();assert.equal(failures,2);
});
