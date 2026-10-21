import {decodeEventLog,parseAbi,type Hex} from 'viem';
import {verifyDirectDeployment,deploymentHint} from '../../src/services/customDeveloperVerification.js';
import {getPonsFactoryDeployments} from '../../src/chains/robinhood/ponsContracts.js';
import {address,hash,type Chain} from './model.js';
import type {Reader} from './providers.js';
export type CreatorProof={creator:string;transaction:string;source:'PONS_FACTORY_EVENT'|'CHAIN_DEPLOYMENT_RECEIPT';block:string};
// No scans: one metadata hint, one receipt, one transaction and one canonical block.
// PONS attribution comes from the exact approved factory event, never receipt.from.
export async function verifiedCreator(reader:Reader,chain:Chain,token:string,info:any,head:string):Promise<CreatorProof|null>{
 if(!hash(info?.creation_transaction_hash)||!/^0x[0-9a-f]+$/i.test(head))return null;
 const transaction=info.creation_transaction_hash.toLowerCase();
 const receipt=await reader.rpc(chain,'eth_getTransactionReceipt',[transaction]);
 if(receipt?.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==transaction||!hash(receipt.blockHash)||!/^0x[0-9a-f]+$/i.test(receipt.blockNumber??'')||BigInt(head)<BigInt(receipt.blockNumber)+12n)return null;
 const tx=await reader.rpc(chain,'eth_getTransactionByHash',[transaction]);
 const block=await reader.rpc(chain,'eth_getBlockByNumber',[receipt.blockNumber,false]);
 const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
 if(!same(tx?.hash,transaction)||!same(tx?.blockHash,receipt.blockHash)||tx?.blockNumber!==receipt.blockNumber||!same(block?.hash,receipt.blockHash)||block?.number!==receipt.blockNumber||!Array.isArray(block.transactions)||!block.transactions.some((h:unknown)=>same(h,transaction)))return null;
 if(chain==='robinhood'&&Array.isArray(receipt.logs)&&receipt.logs.length<=100){
  const creators=new Set<string>();
  for(const log of receipt.logs){
   const factory=getPonsFactoryDeployments().find(f=>f.enabled&&same(f.address,log?.address));
   const n=BigInt(receipt.blockNumber);
   if(!factory||(factory.startBlock!==null&&n<factory.startBlock)||(factory.endBlock!==undefined&&n>factory.endBlock)||log.removed||!same(log.transactionHash,transaction)||!same(log.blockHash,receipt.blockHash)||log.blockNumber!==receipt.blockNumber)continue;
   try{const decoded=decodeEventLog({abi:parseAbi([factory.tokenLaunchedEvent]),data:log.data,topics:log.topics as [Hex,...Hex[]]}) as unknown as {args:{token?:string;deployer?:string}};
    if(same(decoded.args.token,token)&&address(decoded.args.deployer)&&!/^0x0{40}$/i.test(decoded.args.deployer))creators.add(decoded.args.deployer.toLowerCase());
   }catch{/* Non-launch event. */}
  }
  if(creators.size>1)return null;
  if(creators.size===1)return {creator:[...creators][0],transaction,source:'PONS_FACTORY_EVENT',block:receipt.blockNumber};
 }
 const hint=deploymentHint(token,info);if(!hint)return null;
 const code=await reader.rpc(chain,'eth_getCode',[token,head]);
 const proof=verifyDirectDeployment({chain,token,hint,chainId:chain==='robinhood'?'0x1237':'0x13b2',tx,receipt,block,head,code});
 return proof?{creator:proof.creator,transaction,source:proof.source,block:receipt.blockNumber}:null;
}
