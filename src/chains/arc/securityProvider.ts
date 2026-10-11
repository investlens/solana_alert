import {arcBoostSafetyFromEvidence,type ArcBoostSafety} from './boostSafety.js';
type Dependencies={fetch:typeof fetch;wait:(ms:number)=>Promise<void>};
export function createArcSecurityLoader(deps:Dependencies){
 return async(token:string):Promise<ArcBoostSafety>=>{
  if(!/^0x[a-f0-9]{40}$/i.test(token))return {allowed:false,reason:'Invalid ARC token'};
  const signal=AbortSignal.timeout(4000);
  for(let attempt=0;attempt<2;attempt++){
   try{
    const response=await deps.fetch(`https://api.gopluslabs.io/api/v1/token_security/5042?contract_addresses=${encodeURIComponent(token)}`,{headers:{accept:'application/json'},signal});
    if(!response.ok){
     if(response.status>=500&&attempt===0){await deps.wait(200);continue;}
     return {allowed:false,reason:`ARC security provider HTTP ${response.status}; alert withheld`};
    }
    const payload=await response.json() as {code?:number;message?:string;result?:Record<string,Record<string,unknown>>|null};
    if(payload.code!==1){
     if(payload.code===5000&&attempt===0){await deps.wait(200);continue;}
     return {allowed:false,reason:`ARC security provider error ${payload.code??'unknown'}; alert withheld`};
    }
    const key=Object.keys(payload.result??{}).find(k=>k.toLowerCase()===token.toLowerCase());
    const evidence=key?payload.result?.[key]:undefined;
    const result=arcBoostSafetyFromEvidence(evidence);
    if(!result.allowed&&!result.sellabilityBlocked){
     const missing=['is_honeypot','cannot_sell_all'].filter(f=>String(evidence?.[f])!=='0');
     return {...result,reason:evidence?`ARC security evidence incomplete (${missing.join(', ')}); alert withheld`:'ARC security provider returned no token evidence; alert withheld'};
    }
    return result;
   }catch{
    if(attempt===0&&!signal.aborted){await deps.wait(200);continue;}
    return {allowed:false,reason:'ARC security provider request failed or timed out; alert withheld'};
   }
  }
  return {allowed:false,reason:'ARC security provider unavailable; alert withheld'};
 };
}
export const loadArcSecurity=createArcSecurityLoader({fetch:(input,init)=>fetch(input,init),wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
