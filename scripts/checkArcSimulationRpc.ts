// Read-only: no signed or broadcast transactions. Never print a credential-bearing endpoint.
import {randomBytes} from 'node:crypto';
import {arcFundingProbe,validateArcFundingProbe,readArcProbeResponse} from '../src/chains/arc/simulationCapability.js';
import type {Address} from 'viem';
const endpoint=process.env.ARC_SIMULATION_RPC_URL;
if(!endpoint)throw Error('Set ARC_SIMULATION_RPC_URL privately to the ARC endpoint being validated');
const signal=AbortSignal.timeout(12000); // One shared deadline for both requests; no retries or polling.
const rpc=async(method:string,params:unknown[])=>{
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal});
 if(!response.ok)throw Error(`ARC probe HTTP ${response.status}`);
 const payload=await readArcProbeResponse(response);if(payload.error||payload.result==null)throw Error(`ARC probe rejected ${method} (code ${payload.error?.code??'unknown'})`);return payload.result;
};
try{
 const chainId=await rpc('eth_chainId',[]),wallet=('0x'+randomBytes(20).toString('hex')) as Address,recipient=('0x'+randomBytes(20).toString('hex')) as Address;
 if(BigInt(chainId)!==5042n)throw Error('Endpoint is not ARC mainnet');
 const result=await rpc('eth_simulateV1',arcFundingProbe(wallet,recipient));
 if(!validateArcFundingProbe(chainId,result))throw Error('Native USDC/ERC20 balance alias or sequential state changes unverified');
 console.log('ARC_CAPABILITY_PASS: chain 5042; sequential simulation; native 18 / ERC20 6 funding and transfer verified. Real-pool three-size buy/full-sell validation still required.');
}catch(error){console.error(error instanceof Error?error.message:'ARC capability probe failed');process.exitCode=1;}
