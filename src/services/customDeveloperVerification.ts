import { getContractAddress } from 'viem';

export type DeveloperChain = 'robinhood'|'arc';
export type DeploymentProof = {
 chain: DeveloperChain; token: string; creator: string; transactionHash: string;
 blockNumber: string; blockHash: string; source: 'CHAIN_DEPLOYMENT_RECEIPT';
};
const address=(v:unknown):v is string=>typeof v==='string' && /^0x[a-f0-9]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
const hash=(v:unknown):v is string=>typeof v==='string' && /^0x[a-f0-9]{64}$/i.test(v);
const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
const quantity=(v:unknown):bigint|null=>{try{return typeof v==='string'&&/^0x(?:0|[1-9a-f][a-f0-9]*)$/i.test(v)?BigInt(v):null;}catch{return null;}};

// Explorer metadata supplies a lookup hint, never sufficient identity proof.
export function deploymentHint(token:string,payload:any):{creator:string;hash:string}|null {
 if(!address(token)||!same(payload?.hash,token)||payload?.is_contract!==true
  ||!address(payload?.creator_address_hash)||!hash(payload?.creation_transaction_hash))return null;
 return {creator:payload.creator_address_hash.toLowerCase(),hash:payload.creation_transaction_hash.toLowerCase()};
}

export function verifyDirectDeployment(args:{chain:DeveloperChain;token:string;hint:{creator:string;hash:string};chainId:unknown;tx:any;receipt:any;block:any;head:unknown;code:unknown}):DeploymentProof|null {
 const {chain,token,hint,tx,receipt:r,block:b}=args;
 const expected=chain==='robinhood'?4663n:chain==='arc'?5042n:null;
 const chainId=quantity(args.chainId),n=quantity(r?.blockNumber),head=quantity(args.head),nonce=quantity(tx?.nonce);
 if(expected===null||chainId!==expected||!address(token)||!address(hint?.creator)||!hash(hint?.hash)
  ||!tx||!r||tx.to!==null||r.to!==null||r.status!=='0x1'||n===null||head===null||head<n+12n||nonce===null
  ||!same(tx.hash,hint.hash)||!same(r.transactionHash,hint.hash)||!same(tx.from,hint.creator)||!same(r.from,hint.creator)
  ||quantity(tx.chainId)!==expected||quantity(tx.blockNumber)!==n||!hash(r.blockHash)||!same(tx.blockHash,r.blockHash)
  ||!same(r.contractAddress,token)||quantity(b?.number)!==n||!same(b?.hash,r.blockHash)
  ||!Array.isArray(b?.transactions)||!b.transactions.some((h:unknown)=>same(h,hint.hash))
  ||typeof args.code!=='string'||!/^0x(?:[a-f0-9]{2})+$/i.test(args.code))return null;
 // CREATE's sender+nonce must independently derive this exact token address.
 // Factory/internal deployments have no top-level contractAddress and fail here.
 if(!same(getContractAddress({from:hint.creator as `0x${string}`,nonce}),token))return null;
 return {chain,token:token.toLowerCase(),creator:hint.creator.toLowerCase(),transactionHash:hint.hash.toLowerCase(),blockNumber:n.toString(),blockHash:r.blockHash.toLowerCase(),source:'CHAIN_DEPLOYMENT_RECEIPT'};
}

export async function readDirectDeployment(chain:DeveloperChain,token:string,deps:{explorer:(token:string)=>Promise<unknown>;rpc:(method:string,params:unknown[])=>Promise<unknown>}):Promise<DeploymentProof|null> {
 if(!address(token)||!['robinhood','arc'].includes(chain))return null;
 const hint=deploymentHint(token,await deps.explorer(token)); if(!hint)return null;
 // Fixed maximum: six RPC reads; sequential and no pagination or retries.
 const chainId=await deps.rpc('eth_chainId',[]);
 if(quantity(chainId)!==(chain==='robinhood'?4663n:5042n))return null;
 const tx=await deps.rpc('eth_getTransactionByHash',[hint.hash]) as any;
 if(!tx||tx.to!==null||!same(tx.from,hint.creator))return null;
 const receipt=await deps.rpc('eth_getTransactionReceipt',[hint.hash]) as any;
 if(!receipt||receipt.status!=='0x1'||!same(receipt.contractAddress,token)||quantity(receipt.blockNumber)===null)return null;
 const block=await deps.rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
 const head=await deps.rpc('eth_blockNumber',[]);
 const code=await deps.rpc('eth_getCode',[token,'latest']);
 return verifyDirectDeployment({chain,token,hint,chainId,tx,receipt,block,head,code});
}
