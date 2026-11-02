/** Read-only, two-request probe of a third-party Solana program's chain state.
 * A program-data-account hash is NOT a verified binary build or source audit.
 * Do not expose keys, sign, send, or treat upgrade authority as trust.
 */
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
const id='FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe';
const endpoint='https://api.mainnet-beta.solana.com/';
const loader='BPFLoaderUpgradeab1e11111111111111111111111';
let calls=0;
async function getAccount(pubkey:string){
 if(calls>=2)throw Error('PUBLIC_CHAIN_RPC_BUDGET_EXCEEDED');
 calls++;
 const result=await fetch(endpoint,{method:'POST',
  headers:{'content-type':'application/json'},signal:AbortSignal.timeout(5000),
  body:JSON.stringify({jsonrpc:'2.0',id:calls,method:'getAccountInfo',
   params:[pubkey,{encoding:'base64',commitment:'confirmed'}]})});
 if(!result.ok)throw Error('PUBLIC_RPC_HTTP_'+result.status);
 const json=await result.json();
 if(json.error)throw Error('PUBLIC_RPC_ERROR_'+String(json.error.code));
 const account=json.result?.value;
 if(!account||!Array.isArray(account.data)||typeof account.data[0]!=='string')
  throw Error('PUBLIC_PROGRAM_ACCOUNT_MISSING');
 return {owner:account.owner as string,executable:account.executable===true,
  raw:Buffer.from(account.data[0],'base64')};
}
let reason:string|null=null;
let programExecutable=false,upgradeable=false,programDataHash:string|null=null;
let deploymentSlot:string|null=null,upgradeAuthority:string|null=null;
try{
 const prog=await getAccount(id);
 programExecutable=prog.executable;
 if(prog.owner!==loader||!prog.executable||prog.raw.length<36||
    prog.raw.readUInt32LE(0)!==2)throw Error('UNKNOWN_NON_UPGRADEABLE_PROGRAM_FORMAT');
 upgradeable=true;
 const pd=new PublicKey(prog.raw.subarray(4,36)).toBase58();
 const data=await getAccount(pd);
 if(data.owner!==loader||data.raw.length<45||data.raw.readUInt32LE(0)!==3)
  throw Error('INVALID_PROGRAM_DATA_ACCOUNT');
 programDataHash=createHash('sha256').update(data.raw).digest('hex');
 deploymentSlot=data.raw.readBigUInt64LE(4).toString();
 const option=data.raw.readUInt8(12);
 if(option===1)upgradeAuthority=new PublicKey(data.raw.subarray(13,45)).toBase58();
 else if(option!==0)throw Error('INVALID_UPGRADE_AUTHORITY_OPTION');
}catch(err){reason=err instanceof Error?err.message:'UNKNOWN_PUBLIC_PROBE_FAILURE';}
const report={mode:'READ_ONLY_PROGRAM_PROVENANCE',programId:id,
 rpcCalls:calls,programExecutable,upgradeable,upgradeAuthorityPresent:upgradeAuthority!==null,
 upgradeAuthorityKnown:upgradeAuthority!==null,programDataAccountHash:programDataHash,
 deploymentSlot,reason,sourceBinaryReproducible:false,
 feeAndCpiSemanticsAudited:false,
 trustedExecutable:false,signingApproved:false,broadcast:false};
process.stdout.write('ECHO_PROGRAM_PROVENANCE '+JSON.stringify(report)+'\n');
if(reason)process.exitCode=1;
