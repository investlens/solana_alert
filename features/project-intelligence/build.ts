import {randomBytes} from 'node:crypto';
import {createCustomExitVerifier} from '../../src/services/customTokenExitVerification.js';
import {research} from './report.js';
import type {Reader} from './providers.js';
import type {Chain} from './model.js';
// Reuse the tested pure verifier through dependency injection. Its default
// transport, shared cache and governor are never invoked by this worker.
export function buildReport(chain:Chain,token:string,reader:Reader){
 return research(chain,token,{reader,verifyExit:async(c,t,p,security,pairs)=>{
  const verifier=createCustomExitVerifier({now:Date.now,wallet:()=>('0x'+randomBytes(20).toString('hex')) as `0x${string}`,rpc:(chain,method,params,signal)=>reader.rpc(chain,method,params,signal),pairs:async()=>pairs,security:async()=>security});
  return verifier({chain:c,token:t,pairId:p,security});
 }});
}
