/** Read-only simulation boundary. Never accepts private keys and never calls
 * sendTransaction or sendRawTransaction. Transaction bytes must originate from
 * a separately validated unsigned transaction builder, not a chat callback.
 */
export function readEchoWalletIdentity(env:NodeJS.ProcessEnv) {
 const address=env.ECHO_EXECUTION_WALLET_PUBLIC_KEY?.trim();
 if(!address||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address))
  return {configured:false as const,reason:'ISOLATED_EXECUTION_WALLET_PUBLIC_KEY_REQUIRED'};
 if(env.ECHO_EXECUTION_PRIVATE_KEY||env.ECHO_EXECUTION_SECRET_KEY)
  throw Error('SIGNING_SECRETS_NOT_ALLOWED_IN_ECHO_ALERT_WORKER');
 return {configured:true as const,address};
}
export async function simulateEchoUnsignedTransaction(
 rpcUrl:string,transactionBase64:string,
 post:typeof fetch=fetch
):Promise<{ok:boolean;reason:string;logs?:string[];failureClass?:string}>{
 let host:URL;
 try{host=new URL(rpcUrl);}catch{return {ok:false,reason:'INVALID_RPC_URL'};}
 if(host.protocol!=='https:'||host.username||host.password||!/^[-_A-Za-z0-9+/=]+$/.test(transactionBase64)||
    transactionBase64.length<100||transactionBase64.length>3000)
  return {ok:false,reason:'INVALID_READ_ONLY_SIMULATION_INPUT'};
 try{
  const response=await post(host.toString(),{
   method:'POST',headers:{'content-type':'application/json'},
   signal:AbortSignal.timeout(4000),
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'simulateTransaction',
     params:[transactionBase64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:true,commitment:'processed'}]})
  });
  if(!response.ok)return {ok:false,reason:'RPC_UNAVAILABLE'};
  const result=await response.json();
  if(result?.error||!result?.result?.value)return {ok:false,reason:'SIMULATION_UNAVAILABLE'};
  if(result.result.value.err){
    const evidence=JSON.stringify(result.result.value.err).slice(0,2000)+' '+
      (Array.isArray(result.result.value.logs)?
       result.result.value.logs.slice(-12).map(String).join(' ').slice(0,2000):'');
    const failureClass=/InsufficientFunds|insufficient funds|insufficient lamports|insufficient token/i.test(evidence)?
      'INSUFFICIENT_FUNDS_OR_TOKENS':
      /AccountNotFound|account not found|InvalidAccountForFee/i.test(evidence)?
      'ACCOUNT_NOT_PRESENT':
      /BlockhashNotFound|blockhash not found/i.test(evidence)?
      'BLOCKHASH_EXPIRED':'ONCHAIN_INSTRUCTION_REJECTED';
    return {ok:false,reason:'SIMULATION_REJECTED',failureClass};
  }
  return {ok:true,reason:'READ_ONLY_SIMULATION_OK',logs:Array.isArray(result.result.value.logs)?
    result.result.value.logs.slice(0,10).map(String):[]};
 }catch{return {ok:false,reason:'SIMULATION_NETWORK_ERROR'};}
}
export const ECHO_SEND_TRANSACTION_ENABLED=false as const;
