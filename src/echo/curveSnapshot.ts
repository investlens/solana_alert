/** Optional pre-graduation snapshot. Never infer bonded liquidity from a curve valuation. */
export type CurveSnapshot={name:string;symbol:string;marketCap:number|null;creator:string|null;devHoldingPercent:number|null};
const validAddress=(v:unknown):v is string=>typeof v==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const positive=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
export async function pumpCurveSnapshot(mint:string,rpcUrl:string):Promise<CurveSnapshot|null>{
 if(!validAddress(mint))return null;
 try{
  // Unofficial frontend endpoint: best-effort only; may change or require auth.
  let coin:Record<string,unknown>|null=null;
  for(const endpoint of ['coins-v2/','coins/']){
   try{
    const res=await fetch('https://frontend-api-v3.pump.fun/'+endpoint+mint,{signal:AbortSignal.timeout(1800)});
    if(!res.ok)continue;
    const body=await res.json() as Record<string,unknown>;
    if(body?.mint===mint){coin=body;break;}
   }catch{/* Try the other endpoint. */}
  }
  if(!coin)return null;
  if(coin.mint!==mint||coin.complete===true)return null;
  const creator=validAddress(coin.creator)?coin.creator:null;
  let devHoldingPercent:number|null=null;
  if(creator){
   try{
    const requests=[
      {jsonrpc:'2.0',id:1,method:'getTokenSupply',params:[mint,{commitment:'confirmed'}]},
      {jsonrpc:'2.0',id:2,method:'getTokenAccountsByOwner',params:[creator,{mint},{encoding:'jsonParsed',commitment:'confirmed'}]}
    ];
    const reply=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify(requests),signal:AbortSignal.timeout(2200)});
    if(reply.ok){
      const result=await reply.json() as Array<any>;
      if(Array.isArray(result)){
       const supply=result.find(x=>x.id===1)?.result?.value?.amount;
       const accounts=result.find(x=>x.id===2)?.result?.value;
       if(typeof supply==='string'&&/^\d+$/.test(supply)&&BigInt(supply)>0n&&Array.isArray(accounts)){
        let holding=0n;
        for(const row of accounts){const amount=row?.account?.data?.parsed?.info?.tokenAmount?.amount;
         if(typeof amount==='string'&&/^\d+$/.test(amount))holding+=BigInt(amount);}
        devHoldingPercent=Math.round(Number(holding*10000n/BigInt(supply))/100*100)/100;
        if(!Number.isFinite(devHoldingPercent)||devHoldingPercent>100)devHoldingPercent=null;
       }
      }
    }
   }catch{/* creator holdings not verified */}
  }
  return {name:String(coin.name??'').slice(0,64),symbol:String(coin.symbol??'').slice(0,24),
   marketCap:positive(coin.usd_market_cap)??positive(coin.market_cap_usd),creator,devHoldingPercent};
 }catch{return null;}
}
