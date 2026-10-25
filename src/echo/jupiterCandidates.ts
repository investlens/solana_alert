import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { ECHO_WALLETS } from './signals.js';
export const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const key = (v:any):string => typeof v === 'string' ? v : v?.toBase58?.() ?? '';
export type EchoRoutedCandidate = {
  caller:string; wallet:string; mint:string; side:'BUY'|'SELL';
  tokenRaw:string; usdcRaw:string; signature:string; verification:'CANDIDATE_ONLY';
};
/** Strict observational routing candidates; never sent to Telegram or considered verified executable swaps. */
export function identifyJupiterCandidates(tx:ParsedTransactionWithMeta|null,signature:string):EchoRoutedCandidate[]{
  if(!tx?.meta || tx.meta.err!==null || tx.transaction.signatures[0]!==signature) return [];
  const keys=tx.transaction.message.accountKeys;
  const instructions=[...tx.transaction.message.instructions,...(tx.meta.innerInstructions??[]).flatMap(x=>x.instructions)];
  if(!instructions.some(ix=>key(ix.programId)===JUPITER_V6 && 'data' in ix && 'accounts' in ix))return [];
  const found:EchoRoutedCandidate[]=[];
  for(const [wallet,caller] of Object.entries(ECHO_WALLETS)){
    if(!keys.some(k=>k.signer===true&&key(k.pubkey)===wallet))continue;
    const before=new Map<number,{mint:string;owner:string;raw:bigint;decimals:number}>();
    const after=new Map<number,{mint:string;owner:string;raw:bigint;decimals:number}>();
    for(const [balances,map] of [[tx.meta.preTokenBalances??[],before],[tx.meta.postTokenBalances??[],after]] as const){
      for(const b of balances)if(b.owner===wallet&&/^\d+$/.test(b.uiTokenAmount.amount)){
        map.set(b.accountIndex,{mint:b.mint,owner:wallet,raw:BigInt(b.uiTokenAmount.amount),decimals:b.uiTokenAmount.decimals});
      }
    }
    const totals=new Map<string,bigint>();let invalid=false;
    for(const index of new Set([...before.keys(),...after.keys()])){
      const a=before.get(index),b=after.get(index);
      if(a&&b&&(a.mint!==b.mint||a.decimals!==b.decimals)){invalid=true;break;}
      const v=a??b;if(!v)continue;
      const delta=(b?.raw??0n)-(a?.raw??0n);
      totals.set(v.mint,(totals.get(v.mint)??0n)+delta);
    }
    if(invalid)continue;
    const changed=[...totals].filter(([,n])=>n!==0n);
    if(changed.length!==2)continue;
    const usdc=totals.get(USDC);
    if(usdc===undefined||usdc===0n)continue;
    const other=changed.find(([mint])=>mint!==USDC);
    if(!other||other[1]===0n||other[1]*usdc>=0n)continue;
    found.push({caller,wallet,mint:other[0],side:usdc<0n?'BUY':'SELL',
      tokenRaw:other[1].toString(),usdcRaw:usdc.toString(),signature,verification:'CANDIDATE_ONLY'});
  }
  return found;
}
