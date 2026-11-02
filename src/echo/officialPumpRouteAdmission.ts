/** Pump official-SDK route admission: structural screening only, never signs.
 * Non-SOL quote pools MUST NOT be passed to a single-hop SOL buy builder.
 * Route objects are independent trusted on-chain observations, not user flags.
 */
export const ECHO_OFFICIAL_ROUTE_SIGNING_ENABLED=false as const;
export const ECHO_PUMP_WSOL='So11111111111111111111111111111111111111112';
export type VerifiedPoolHop={
 baseMint:string;quoteMint:string;poolAddress:string;verifiedFromChain:boolean;
 canonicalPumpPool:boolean;mayhemMode:boolean;
};
export type RouteAdmission=
 |{ok:true;route:'SINGLE_HOP_SOL'|'MULTI_HOP_SOL';hops:number;executable:false}
 |{ok:false;reason:string;executable:false};
const addr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function screenOfficialPumpRoute(targetMint:string,
 hops:readonly VerifiedPoolHop[]):RouteAdmission{
 const deny=(reason:string):RouteAdmission=>({ok:false,reason,executable:false});
 if(!addr.test(targetMint)||hops.length<1||hops.length>3)
  return deny('INVALID_TARGET_OR_HOP_COUNT');
 if(hops.some(h=>!addr.test(h.baseMint)||!addr.test(h.quoteMint)||
  !addr.test(h.poolAddress)||!h.verifiedFromChain||!h.canonicalPumpPool||
   h.mayhemMode))
  return deny('UNVERIFIED_OR_UNSUPPORTED_POOL');
 let coin=ECHO_PUMP_WSOL;
 const seen=new Set([coin]);
 for(const h of hops){
  if(h.quoteMint!==coin||seen.has(h.baseMint))
   return deny('DISCONTINUOUS_OR_CYCLIC_ROUTE');
  coin=h.baseMint;
  seen.add(coin);
 }
 if(coin!==targetMint)return deny('WRONG_OUTPUT_TOKEN');
 return {ok:true,route:hops.length===1?'SINGLE_HOP_SOL':'MULTI_HOP_SOL',
  hops:hops.length,executable:false};
}
