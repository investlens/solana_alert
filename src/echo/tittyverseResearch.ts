/**
 * Tittyverse ecosystem intelligence for AlphaOS Echo.
 *
 * Offline, read-only research only. Site membership and visual "orbits" are
 * NOT on-chain liquidity-pair evidence. Pool edges must be independently
 * verified by a trusted source before entering this graph.
 * No RPC calls, no Telegram delivery, no trade execution, no prioritization
 * of live verified caller BUY alerts.
 */
export const TITTYVERSE_RESEARCH_ONLY = true as const;
export const TITTYVERSE_AUTO_BUY_ENABLED = false as const;
export const TITTYVERSE_ROOT_MINT = 'C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump';
export const SLINGOOR_VERIFIED_WALLET = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
export type ResearchToken = {
  mint: string; symbol: string; observedAtMs: number;
  marketCapUsd: number | null; liquidityUsd: number | null;
  /** True ONLY when explicit mint appears in an independently saved Tittyverse listing. */
  inTittyverse: boolean;
};
export type VerifiedPair = {
  pairAddress: string; mintA: string; mintB: string;
  verifiedAtMs: number; source: 'DEXSCREENER' | 'ONCHAIN';
  /** false for unverified website 'orbit' links */
  verified: true;
};
export type VerifiedCallerBuy = {
  wallet: string; mint: string; signature: string; blockTimeMs: number;
  signerVerified: boolean; side: 'BUY' | 'SELL'; transferOnly: boolean;
};
export type ResearchFinding = {
  mint: string; symbol: string; observedAtMs: number;
  marketCapUsd: number | null; liquidityUsd: number | null;
  directBtcPool: boolean; verifiedPairCount: number; graphDepth: number | null;
  candidate1kTo5k: boolean; thinLiquidity: boolean; noVerifiedPairs: boolean;
  slingoorFirstBuyAtMs: number | null; slingoorFirstBuySignature: string | null;
  discoveredBeforeBuy: boolean | null; leadTimeSeconds: number | null;
  /** Candidate only; never a trading instruction. */
  action: 'RESEARCH_ONLY';
};
const mintPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const finiteTimestamp = (n: number) => Number.isSafeInteger(n) && n > 0;
const validUsd = (n:number|null) => n === null || (Number.isFinite(n) && n >= 0 && n <= 1e15);
export function evaluateTittyverseSnapshot(input: {
 tokens: readonly ResearchToken[]; pairs: readonly VerifiedPair[];
 buys: readonly VerifiedCallerBuy[]; rootMint?: string;
}): ResearchFinding[] {
 const {tokens,pairs,buys} = input;
 if(tokens.length > 500 || pairs.length > 1500 || buys.length > 1500)
  throw Error('RESEARCH_SNAPSHOT_LIMIT_EXCEEDED');
 const root = input.rootMint ?? TITTYVERSE_ROOT_MINT;
 if(!mintPattern.test(root))throw Error('INVALID_ROOT_MINT');
 const tokensByMint=new Map<string,ResearchToken>();
 for(const t of tokens) {
  if(!mintPattern.test(t.mint)||tokensByMint.has(t.mint)||
     typeof t.symbol !== 'string' || t.symbol.length > 32 ||
     !finiteTimestamp(t.observedAtMs)||!validUsd(t.marketCapUsd)||
     !validUsd(t.liquidityUsd)||typeof t.inTittyverse !== 'boolean')
   throw Error('INVALID_RESEARCH_TOKEN');
  tokensByMint.set(t.mint,t);
 }
 const adjacency=new Map<string,Set<string>>();
 const distinctPairs=new Map<string,Set<string>>();
 const pairAddresses=new Set<string>();
 function neighbor(a:string,b:string) {
  let node=adjacency.get(a);if(!node){node=new Set();adjacency.set(a,node);}node.add(b);
 }
 for(const p of pairs){
  if(!p.verified || !['ONCHAIN','DEXSCREENER'].includes(p.source) ||
     !mintPattern.test(p.pairAddress)||!mintPattern.test(p.mintA)||
     !mintPattern.test(p.mintB)||p.mintA===p.mintB||
     !finiteTimestamp(p.verifiedAtMs)||pairAddresses.has(p.pairAddress))
    throw Error('INVALID_OR_DUPLICATE_VERIFIED_PAIR');
  pairAddresses.add(p.pairAddress);
  neighbor(p.mintA,p.mintB);neighbor(p.mintB,p.mintA);
  for(const mint of [p.mintA,p.mintB]){
    let list=distinctPairs.get(mint);if(!list){list=new Set();distinctPairs.set(mint,list);}
    list.add(p.pairAddress);
  }
 }
 const depths=new Map<string,number>([[root,0]]);
 const queue=[root];
 for(let i=0;i<queue.length&&i<1502;i++){
  const mint=queue[i],level=depths.get(mint)!;
  for(const next of adjacency.get(mint)??[]){
   if(!depths.has(next)){depths.set(next,level+1);queue.push(next);}
  }
 }
 const firstBuy=new Map<string,VerifiedCallerBuy>();
 for(const b of buys){
  if(!mintPattern.test(b.wallet)||!mintPattern.test(b.mint)||
     !signaturePattern.test(b.signature)||!finiteTimestamp(b.blockTimeMs)||
     typeof b.signerVerified!=='boolean'||typeof b.transferOnly!=='boolean'||
     (b.side!=='BUY'&&b.side!=='SELL'))throw Error('INVALID_CALLER_EVENT');
  if(b.wallet!==SLINGOOR_VERIFIED_WALLET||!b.signerVerified||
     b.transferOnly||b.side!=='BUY')continue;
  const existing=firstBuy.get(b.mint);
  if(!existing||b.blockTimeMs<existing.blockTimeMs)firstBuy.set(b.mint,b);
 }
 return [...tokensByMint.values()].filter(t=>t.inTittyverse).map(t=>{
  const buy=firstBuy.get(t.mint),lead=buy?Math.floor((buy.blockTimeMs-t.observedAtMs)/1000):null;
  const count=distinctPairs.get(t.mint)?.size??0;
  return {
   mint:t.mint,symbol:t.symbol,observedAtMs:t.observedAtMs,
   marketCapUsd:t.marketCapUsd,liquidityUsd:t.liquidityUsd,
   directBtcPool:adjacency.get(t.mint)?.has(root)??false,
   verifiedPairCount:count,graphDepth:depths.get(t.mint)??null,
   candidate1kTo5k:t.marketCapUsd!==null&&t.marketCapUsd>=1000&&t.marketCapUsd<=5000,
   thinLiquidity:t.liquidityUsd===null||t.liquidityUsd<2000,
   noVerifiedPairs:count===0,
   slingoorFirstBuyAtMs:buy?.blockTimeMs??null,
   slingoorFirstBuySignature:buy?.signature??null,
   discoveredBeforeBuy:lead===null?null:lead>0,
   leadTimeSeconds:lead,
   action:'RESEARCH_ONLY' as const
  };
 }).sort((a,b)=>{
  // Prioritize follow-up research, not trading; no zero-liquidity or missing-pair
  // candidate is implicitly considered safe.
  const rank=(v:ResearchFinding)=>Number(v.candidate1kTo5k)*2+Number(v.verifiedPairCount>=2);
  return rank(b)-rank(a)||a.observedAtMs-b.observedAtMs||a.mint.localeCompare(b.mint);
 });
}
