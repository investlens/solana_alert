/** Historical signer-owned receipts only. Records net wallet changes,
 * not exact pool fee attribution. NEVER signs or submits a transaction.
 */
export const ECHO_RECEIPT_OUTCOME_ALLOWS_EXECUTION=false as const;
type Token={owner:string;mint:string;amount:string};
export type EchoReceipt={
 signature:string;successful:boolean;confirmed:boolean;
 signerWallets:string[];wallet:string;mint:string;
 walletSolBeforeLamports:string;walletSolAfterLamports:string;
 preTokenBalances:Token[];postTokenBalances:Token[];feeLamports:string|null;
};
type Observed={ok:true;side:'BUY'|'SELL';solDelta:bigint;tokenDelta:bigint;
 feeLamports:bigint}|{ok:false;reason:string};
const parse=(x:string|null)=>x!==null&&/^(0|[1-9][0-9]{0,24})$/.test(x)?BigInt(x):null;
export function observeEchoReceipt(x:EchoReceipt,side:'BUY'|'SELL'):Observed{
 if(!x.confirmed||!x.successful||x.signerWallets.length!==1||
  x.signerWallets[0]!==x.wallet||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(x.signature))
  return {ok:false,reason:'CONFIRMED_SIGNER_SWAP_REQUIRED'};
 const before=parse(x.walletSolBeforeLamports),after=parse(x.walletSolAfterLamports),fee=parse(x.feeLamports);
 if(before===null||after===null||fee===null)return {ok:false,reason:'SOL_OR_FEE_EVIDENCE_MISSING'};
 const solDelta=after-before;
 if(side==='BUY'&&solDelta>=0n||side==='SELL'&&solDelta<=0n)
  return {ok:false,reason:'WRONG_SOL_DIRECTION'};
 const changes=new Map<string,bigint>();
 for(const [factor,rows] of [[-1n,x.preTokenBalances],[1n,x.postTokenBalances]] as const){
  for(const row of rows){
   if(row.owner!==x.wallet)continue;
   const amount=parse(row.amount);
   if(amount===null)return {ok:false,reason:'TOKEN_DELTA_INVALID'};
   changes.set(row.mint,(changes.get(row.mint)??0n)+factor*amount);
  }
 }
 const tokenDelta=changes.get(x.mint)??0n;
 if(side==='BUY'&&tokenDelta<=0n||side==='SELL'&&tokenDelta>=0n)
  return {ok:false,reason:'WRONG_TOKEN_DIRECTION'};
 if([...changes].some(([m,a])=>m!==x.mint&&a!==0n))
  return {ok:false,reason:'UNRELATED_TOKEN_MOVEMENT'};
 return {ok:true,side,solDelta,tokenDelta,feeLamports:fee};
}
export function reconcileEchoObservedRoundTrip(buy:EchoReceipt,sell:EchoReceipt){
 const b=observeEchoReceipt(buy,'BUY'),s=observeEchoReceipt(sell,'SELL');
 if('reason' in b)return {ok:false as const,reason:'BUY_'+b.reason,signingApproved:false as const};
 if('reason' in s)return {ok:false as const,reason:'SELL_'+s.reason,signingApproved:false as const};
 if(buy.wallet!==sell.wallet||buy.mint!==sell.mint||buy.signature===sell.signature)
  return {ok:false as const,reason:'IDENTITY_MISMATCH',signingApproved:false as const};
 if(-s.tokenDelta<b.tokenDelta)
  return {ok:false as const,reason:'PARTIAL_SELL_OR_MISSING_TOKENS',signingApproved:false as const};
 return {ok:true as const,mode:'HISTORICAL_WALLET_DELTAS' as const,
  buySignature:buy.signature,sellSignature:sell.signature,
  buyTokensRaw:b.tokenDelta.toString(),sellTokensRaw:(-s.tokenDelta).toString(),
  netSolLamports:(b.solDelta+s.solDelta).toString(),
  totalNetworkFeesLamports:(b.feeLamports+s.feeLamports).toString(),
  feesAlreadyInWalletSolDelta:true as const,
  /** Other program/rent transfers can still affect net wallet lamports. */
  feeAttributionVerified:false as const,
  signingApproved:false as const};
}
