import { robinhoodExplorerJson } from './robinhoodExplorerProvider.js';
import { boundedEvidenceCache } from './boundedEvidenceCache.js';
import { tokenBalancePercent } from './tokenBalancePercent.js';
export type IndexedCreatorHolding={percent:number;observedAt:number;source:'BLOCKSCOUT_INDEXED'};
// Exact token only. Missing rows are not proof of a zero balance. No pagination sweeps.
export function parseIndexedCreatorHolding(payload:unknown,token:string,now=Date.now()):IndexedCreatorHolding|null {
  if(!Array.isArray(payload)||!/^0x[a-f0-9]{40}$/i.test(token))return null;
  const rows=payload.filter(row=>row?.token?.address_hash?.toLowerCase?.()===token.toLowerCase());
  if(rows.length!==1)return null;
  const row=rows[0];
  if(row.token.type!=='ERC-20'||typeof row.value!=='string'||!/^\d+$/.test(row.value)
    ||typeof row.token.total_supply!=='string'||!/^\d+$/.test(row.token.total_supply))return null;
  const percent=tokenBalancePercent(BigInt(row.value),BigInt(row.token.total_supply));
  return percent==null?null:{percent,observedAt:now,source:'BLOCKSCOUT_INDEXED'};
}
const read=boundedEvidenceCache<IndexedCreatorHolding>(async key=>{
 const [token,creator]=key.split(':');
 const payload=await robinhoodExplorerJson.read<unknown>(`/addresses/${creator}/token-balances`);
 return parseIndexedCreatorHolding(payload,token);
});
export async function getIndexedCreatorHolding(token:string,creator:string):Promise<IndexedCreatorHolding|null>{
 if(![token,creator].every(a=>/^0x[a-f0-9]{40}$/i.test(a))||/^0x0{40}$/i.test(creator))return null;
 return read(`${token.toLowerCase()}:${creator.toLowerCase()}`);
}
