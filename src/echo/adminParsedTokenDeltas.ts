/**
 * Read-only parsed transaction balance evidence extractor.
 * This is NOT a DEX parser: balance deltas cannot prove a swap or its route.
 * It deliberately never returns a trusted BUY attestation.
 */
export type ParsedTokenBalance=Readonly<{
 accountIndex:number;mint:string;owner?:string;
 uiTokenAmount?:{amount?:string}
}>;
export type TokenDelta=Readonly<{mint:string;owner:string;delta:bigint}>;
export function extractCallerTokenDeltas(
 pre:readonly ParsedTokenBalance[],post:readonly ParsedTokenBalance[],
 caller:string,
):Readonly<{valid:boolean;deltas:readonly TokenDelta[];reason:string}>{
 const parse=(entries:readonly ParsedTokenBalance[])=>{
  const balances=new Map<string,bigint>();
  for(const entry of entries){
   if(!Number.isSafeInteger(entry.accountIndex)||entry.accountIndex<0||
      !entry.mint||!entry.owner||!entry.uiTokenAmount?.amount||
      !/^(0|[1-9][0-9]*)$/.test(entry.uiTokenAmount.amount))throw Error('BAD_BALANCE');
   const key=entry.accountIndex+'|'+entry.mint+'|'+entry.owner;
   if(balances.has(key))throw Error('DUPLICATE_BALANCE');
   balances.set(key,BigInt(entry.uiTokenAmount.amount));
  }
  return balances;
 };
 try{
  const before=parse(pre),after=parse(post);
  const keys=new Set([...before.keys(),...after.keys()]);
  const deltas:TokenDelta[]=[];
  for(const key of keys){
   const [index,mint,owner]=key.split('|');
   if(!index||!mint||!owner)throw Error('BAD_BALANCE');
   if(owner!==caller)continue;
   const delta=(after.get(key)??0n)-(before.get(key)??0n);
   if(delta!==0n)deltas.push({mint,owner,delta});
  }
  return {valid:true,deltas,reason:'UNATTESTED_BALANCE_DELTAS_ONLY'};
 }catch{return {valid:false,deltas:[],reason:'INVALID_TOKEN_BALANCE_EVIDENCE'};}
}
