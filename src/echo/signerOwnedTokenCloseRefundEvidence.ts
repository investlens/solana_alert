/** Read-only account prestate evidence for payer-directed SPL CloseAccount CPIs.
 * It is only a clue: a later confirmed RPC slot does NOT establish the
 * execution-bank prestate and cannot authorize a trade or certify a refund.
 */
import {PublicKey,VersionedTransaction,type AccountInfo} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_TOKEN_CLOSE_REFUND_CAN_SIGN=false as const;
export const ECHO_TOKEN_CLOSE_REFUND_CAN_BROADCAST=false as const;
const TOKEN=new Set([
 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);
export async function observeTokenCloseSourcesReadOnly(input:{
 tx:VersionedTransaction;
 sourceIndexes:readonly number[];
 minSlot:number;
 rpc:{getMultipleAccountsInfoAndContext(
  keys:PublicKey[],config:{commitment:'confirmed';minContextSlot:number}
 ):Promise<{context:{slot:number};value:(AccountInfo<Buffer>|null)[]}>};
}):Promise<{
 status:'CANDIDATE_PRESTATE_ONLY';
 sourceCount:number;existingTokenAccounts:number;
 observedPrestateLamports:string;observedSlot:number;
 exactSimulationBankMatched:false;refundProven:false;
 signingAllowed:false;broadcastAllowed:false
}|{status:'UNVERIFIED';reason:string;signingAllowed:false;broadcastAllowed:false}>{
 const fail=(reason:string)=>({status:'UNVERIFIED' as const,reason,
  signingAllowed:false as const,broadcastAllowed:false as const});
 const {tx,sourceIndexes,minSlot}=input;
 if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET||
    !Number.isSafeInteger(minSlot)||minSlot<=0||
    !Array.isArray(sourceIndexes)||sourceIndexes.length<1||sourceIndexes.length>8||
    new Set(sourceIndexes).size!==sourceIndexes.length||
    sourceIndexes.some(i=>!Number.isSafeInteger(i)||i<=0||
     i>=tx.message.staticAccountKeys.length))
  return fail('INVALID_OR_UNBOUND_TOKEN_CLOSE_SOURCE');
 try{
  const response=await input.rpc.getMultipleAccountsInfoAndContext(
   sourceIndexes.map(i=>tx.message.staticAccountKeys[i]),
   {commitment:'confirmed',minContextSlot:minSlot}
  );
  if(!Number.isSafeInteger(response.context?.slot)||
     response.context.slot<minSlot||
     !Array.isArray(response.value)||
     response.value.length!==sourceIndexes.length)
   return fail('STALE_OR_INCOMPLETE_TOKEN_CLOSE_PRESTATE');
  let existing=0,total=0n;
  for(const account of response.value){
   if(account===null)continue; // Could be an ephemeral account created in simulation.
   if(!TOKEN.has(account.owner.toBase58())||account.executable||
      !Number.isSafeInteger(account.lamports)||account.lamports<0||
      account.data.length>1024)
    return fail('UNTRUSTED_TOKEN_CLOSE_ACCOUNT_PRESTATE');
   existing++;
   total+=BigInt(account.lamports);
  }
  return {status:'CANDIDATE_PRESTATE_ONLY',sourceCount:sourceIndexes.length,
   existingTokenAccounts:existing,observedPrestateLamports:String(total),
   observedSlot:response.context.slot,exactSimulationBankMatched:false,
   refundProven:false,signingAllowed:false,broadcastAllowed:false};
 }catch{return fail('TOKEN_CLOSE_PRESTATE_RPC_UNAVAILABLE');}
}
