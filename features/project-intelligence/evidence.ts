import {address,hash,burn,rawUnits,percentage,type Finding,type Evidence,type Snapshot} from './model.js';
export const transferTopic='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// A top-level contract creation is verified from its successful receipt. Factory
// deployments cannot establish the human/project creator from receipt.from.
export function directCreator(token:string,info:any,receipt:any):string|null{
 if(!address(info?.creator_address_hash)||!hash(info?.creation_transaction_hash))return null;
 if(receipt?.status!=='0x1'||receipt?.to!==null||!address(receipt?.contractAddress)||receipt.contractAddress.toLowerCase()!==token.toLowerCase()
  ||receipt.transactionHash?.toLowerCase()!==info.creation_transaction_hash.toLowerCase()||receipt.from?.toLowerCase()!==info.creator_address_hash.toLowerCase())return null;
 return info.creator_address_hash.toLowerCase();
}
export function outgoingConnections(logs:unknown,token:string,creator:string,from:bigint,to:bigint):{wallet:string;transactions:string[]}[]{
 if(!Array.isArray(logs)||logs.length>100||from<0n||to<from||to-from>511n)throw Error('Unverifiable transfer window');
 const seen=new Set<string>(),wallets=new Map<string,Set<string>>();
 for(const l of logs){
  if(l?.removed||l?.address?.toLowerCase()!==token.toLowerCase()||l?.topics?.length!==3||l.topics[0]?.toLowerCase()!==transferTopic
   ||l.topics[1]?.toLowerCase()!=='0x'+creator.slice(2).toLowerCase().padStart(64,'0')||!/^0x0{24}[0-9a-f]{40}$/i.test(l.topics[2])
   ||!hash(l.transactionHash)||!/^0x[0-9a-f]+$/i.test(l.blockNumber??'')||!/^0x[0-9a-f]+$/i.test(l.logIndex??'')||!/^0x[0-9a-f]{64}$/i.test(l.data??''))throw Error('Unverifiable transfer log');
  const b=BigInt(l.blockNumber);if(b<from||b>to)throw Error('Transfer outside requested window');
  const id=l.transactionHash.toLowerCase()+':'+BigInt(l.logIndex);if(seen.has(id))continue;seen.add(id);
  const wallet='0x'+l.topics[2].slice(-40).toLowerCase();
  if(burn(wallet)||wallet===creator.toLowerCase()||BigInt(l.data)===0n)continue;
  if(!wallets.has(wallet))wallets.set(wallet,new Set());wallets.get(wallet)!.add(l.transactionHash.toLowerCase());
 }
 return [...wallets].map(([wallet,txs])=>({wallet,transactions:[...txs]})).slice(0,3);
}
export function linkedHoldings(snapshot:Snapshot,creator:string,links:{wallet:string;transactions:string[]}[],contractWallets:Set<string>,source:Evidence):Finding[]{
 const findings:Finding[]=[],seen=new Set<string>([creator.toLowerCase()]);let combined=snapshot.balances[creator.toLowerCase()];
 if(combined===undefined)return [];
 for(const link of links){const wallet=link.wallet.toLowerCase();if(seen.has(wallet)||contractWallets.has(wallet)||burn(wallet))continue;seen.add(wallet);
  const balance=snapshot.balances[wallet],pct=balance===undefined?null:percentage(balance,snapshot.supply);if(pct===null)continue;
  combined+=balance;
  findings.push({id:`connection:${wallet}`,section:'connections',quality:'OBSERVED_CONNECTION',severity:'CAUTION',subject:wallet,value:balance.toString(),summary:`Connected address currently holds ${pct} of total supply.`,evidence:[source,...link.transactions.map(transaction=>({...source,transaction}))],limits:'A token transfer or native funding proves a connection, not common ownership. Only bounded transfer/history samples were checked.'});
 }
 const pct=percentage(combined,snapshot.supply);
 if(pct!==null&&findings.length)findings.push({id:'connected-exposure',section:'connections',quality:'OBSERVED_CONNECTION',severity:'CAUTION',value:combined.toString(),summary:`Developer plus checked connected addresses hold ${pct} combined.`,evidence:[source],limits:'Each address counted once; common ownership is unconfirmed. Unchecked wallets are excluded.'});
 return findings;
}
export function holderFindings(raw:any,snapshot:Snapshot,excluded:Set<string>,source:Evidence):Finding[]{
 if(!Array.isArray(raw?.items))throw Error('Holder data unavailable');
 const seen=new Set<string>();let combined=0n;const findings:Finding[]=[];
 for(const h of raw.items.slice(0,20)){const wallet=h?.address?.hash?.toLowerCase();if(!address(wallet)||seen.has(wallet))continue;seen.add(wallet);
  // Indexer rankings are cross-checked against pinned on-chain balances.
  if(excluded.has(wallet)||burn(wallet))continue;
  const balance=snapshot.balances[wallet],pct=balance===undefined?null:percentage(balance,snapshot.supply);if(pct===null)continue;combined+=balance;
  findings.push({id:`holder:${wallet}`,section:'holders',quality:'VERIFIED',severity:'INFO',subject:wallet,value:balance.toString(),summary:`Sampled holder holds ${pct} of total supply.`,evidence:[source],limits:'Ownership and address purpose may be unknown; this is not a complete holder census.'});
 }
 if(combined>snapshot.supply)throw Error('Holder balances exceed supply');
 return findings;
}

export function confirmedFunding(creator:string,transaction:any,receipt:any,tip:bigint):{wallet:string;transactions:string[]}|null{
 if(!hash(transaction?.hash)||transaction.from?.toLowerCase()!==creator.toLowerCase()||!address(transaction.to)||burn(transaction.to)||transaction.to.toLowerCase()===creator.toLowerCase()
  ||!/^0x[0-9a-f]+$/i.test(transaction.value??'')||BigInt(transaction.value)<=0n||!/^0x[0-9a-f]+$/i.test(transaction.blockNumber??'')||BigInt(transaction.blockNumber)>tip
  ||receipt?.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==transaction.hash.toLowerCase()||receipt.from?.toLowerCase()!==creator.toLowerCase()||receipt.to?.toLowerCase()!==transaction.to.toLowerCase())return null;
 return {wallet:transaction.to.toLowerCase(),transactions:[transaction.hash.toLowerCase()]};
}
