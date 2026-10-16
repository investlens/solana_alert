import {pathToFileURL} from 'node:url';
import {address,chainName,tokenAddress,type Chain} from './model.js';
import {createReader,pinnedBlock,contractRead,chainConfig,type Reader,type ProviderConfig} from './providers.js';
export type Probe={check:string;status:'PASS'|'BLOCKED';reason?:string};
const reason=(error:unknown)=>{
 const message=error instanceof Error?error.message:'';
 const status=/HTTP (\d{3})/.exec(message)?.[1];
 return status?'HTTP_'+status:/chain identity/.test(message)?'CHAIN_MISMATCH':/budget/.test(message)?'BUDGET_EXHAUSTED':'UNAVAILABLE_OR_INVALID_RESPONSE';
};
// At most eight bounded requests. Diagnostics never start services or send messages.
export async function providerPreflight(reader:Reader,chain:Chain,token:string):Promise<{checks:Probe[];requests:number;ready:boolean}>{
 const checks:Probe[]=[];
 const check=async(name:string,run:()=>Promise<void>)=>{try{await run();checks.push({check:name,status:'PASS'});}catch(e){checks.push({check:name,status:'BLOCKED',reason:reason(e)});}};
 await check('pinned-chain-token',async()=>{
  const pin=await pinnedBlock(reader,chain),code=await reader.rpc(chain,'eth_getCode',[token,pin.block]);
  if(typeof code!=='string'||!/^0x(?:[a-f0-9]{2})+$/i.test(code))throw Error('Invalid token bytecode');
  const supply=await contractRead(reader,chain,token,pin.block,'totalSupply');if(typeof supply!=='bigint'||supply<=0n)throw Error('Invalid token supply');
  const end=await reader.rpc(chain,'eth_getBlockByNumber',[pin.block,false]);if(end?.hash!==pin.hash)throw Error('Pinned block changed');
 });
 await check('explorer-token',async()=>{const info=await reader.explorer(chain,`addresses/${token}`);if(!address(info?.hash)||info.hash.toLowerCase()!==token||info.is_contract!==true)throw Error('Explorer token mismatch');});
 await check('explorer-holder-sample',async()=>{const info=await reader.explorer(chain,`tokens/${token}/holders`);if(!Array.isArray(info?.items))throw Error('Holder sample unavailable');});
 return {checks,requests:reader.requests(),ready:checks.every(c=>c.status==='PASS')};
}
async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>args[args.indexOf(name)+1];
 if(!args.includes('--chain')||!args.includes('--token'))throw Error('Supply --chain and --token');
 const chain=chainName(arg('--chain')),token=tokenAddress(arg('--token')),prefix=chain==='arc'?'PI_ARC':'PI_ROBINHOOD';
 const missing=[prefix+'_RPC_URL',prefix+'_EXPLORER_URL'].filter(k=>!process.env[k]);
 if(missing.length&&!args.includes('--public')){console.log(JSON.stringify({ready:false,missingConfiguration:missing}));process.exitCode=2;return;}
 const config:ProviderConfig={rpc:{robinhood:process.env.PI_ROBINHOOD_RPC_URL??chainConfig.robinhood.rpc,arc:process.env.PI_ARC_RPC_URL??chainConfig.arc.rpc},explorer:{robinhood:process.env.PI_ROBINHOOD_EXPLORER_URL??chainConfig.robinhood.explorer+'/api/v2',arc:process.env.PI_ARC_EXPLORER_URL??chainConfig.arc.explorer+'/api/v2'},explorerKey:process.env.PI_BLOCKSCOUT_KEY};
 const result=await providerPreflight(createReader(config,{budget:8,signal:AbortSignal.timeout(30000)}),chain,token);
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),chain,...result,fullFeatureReady:false,note:'Read-only provider preflight; does not validate history, social, selling or delivery.'},null,2));
 if(!result.ready)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Research preflight failed; no provider details or credentials logged.');process.exitCode=2;});
