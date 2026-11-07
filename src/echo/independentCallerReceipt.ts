/** Independent read-only caller transaction verification for Echo trading intake.
 * A Telegram alert, cached queue signal, or extracted parser event is NEVER
 * sufficient to create a live trading intent. This verifier re-reads the
 * confirmed chain receipt using an isolated, pinned RPC connection.
 *
 * It deliberately proves ONLY signer identity and token-credit direction.
 * It cannot prove market cap, payer trade debit, PumpSwap quote, all-in fees,
 * CPI envelope, Phantom SELL or permission to trade.
 */
import {PublicKey,type ParsedTransactionWithMeta} from '@solana/web3.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from './liveBuyPolicy.js';
export const ECHO_CALLER_RECEIPT_CAN_SIGN=false as const;
export const ECHO_CALLER_RECEIPT_CAN_BROADCAST=false as const;
const known=new Set([SLINGOOR_WALLET,CHAIRMAN_WALLET]);
const signature=/^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const address=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export interface EchoPinnedCallerRpc{
 getParsedTransaction(signature:string,config:{
  commitment:'confirmed';maxSupportedTransactionVersion:0;
 }):Promise<ParsedTransactionWithMeta|null>;
}
export type EchoCallerReceiptResult=
 |{ok:true;mode:'INDEPENDENT_CHAIN_SIGNER_AND_TOKEN_CREDIT_ONLY';
   signature:string;callerWallet:string;mint:string;
   receivedRaw:string;slot:number;
   feeAndSwapDebitProven:false;marketCapVerified:false;
   pumpQuoteProven:false;manualExitVerified:false;
   canSign:false;canBroadcast:false}
 |{ok:false;reason:string;canSign:false;canBroadcast:false};
const fail=(reason:string):EchoCallerReceiptResult=>
 ({ok:false,reason,canSign:false,canBroadcast:false});
const rawAmount=(x:{uiTokenAmount?:{amount?:string}}|undefined):bigint|null=>{
 const amount=x?.uiTokenAmount?.amount;
 return typeof amount==='string'&&/^(0|[1-9][0-9]{0,30})$/.test(amount)?
  BigInt(amount):null;
};

export async function verifyEchoCallerReceipt(input:{
 rpc:EchoPinnedCallerRpc;
 callerWallet:string;sourceSignature:string;mint:string;
}):Promise<EchoCallerReceiptResult>{
 if(!known.has(input.callerWallet)||!signature.test(input.sourceSignature)||
    !address.test(input.mint))
  return fail('UNTRUSTED_CALLER_OR_SOURCE_IDENTIFIERS');
 let tx:ParsedTransactionWithMeta|null;
 try{tx=await input.rpc.getParsedTransaction(input.sourceSignature,{
  commitment:'confirmed',maxSupportedTransactionVersion:0
 });}catch{return fail('PINNED_RPC_CALLER_RECEIPT_UNAVAILABLE');}
 if(!tx||tx.meta?.err!==null||!tx.meta||
    !Number.isSafeInteger(tx.slot)||tx.slot<=0)
  return fail('MISSING_OR_FAILED_CHAIN_TRANSACTION');
 const keys=tx.transaction.message.accountKeys;
 // Solana's returned parsed account keys carry signer flags independent
 // of the account's appearances as a transfer or token-account owner.
 if(!keys.some(k=>k.pubkey.toBase58()===input.callerWallet&&k.signer))
  return fail('TRACKED_CALLER_DID_NOT_SIGN');
 const before=tx.meta.preTokenBalances??[];
 const after=tx.meta.postTokenBalances??[];
 const relevant=(x:typeof before)=>x.filter(y=>
  y.mint===input.mint&&y.owner===input.callerWallet);
 const credits=new Map<number,bigint>();
 for(const b of relevant(before)){
  const v=rawAmount(b);if(v===null)return fail('UNVERIFIED_TOKEN_BALANCE');
  credits.set(b.accountIndex,(credits.get(b.accountIndex)??0n)-v);
 }
 for(const a of relevant(after)){
  const v=rawAmount(a);if(v===null)return fail('UNVERIFIED_TOKEN_BALANCE');
  credits.set(a.accountIndex,(credits.get(a.accountIndex)??0n)+v);
 }
 const received=[...credits.values()].reduce((sum,value)=>
  sum+(value>0n?value:0n),0n);
 if(received<=0n)return fail('NO_INDEPENDENT_CALLER_TOKEN_CREDIT');
 // We do not assert a BUY solely because a token credit was observed:
 // gifts and transfers can credit the signer. The existing trusted swap
 // classifier must independently verify the trade debit and program route.
 return {ok:true,mode:'INDEPENDENT_CHAIN_SIGNER_AND_TOKEN_CREDIT_ONLY',
  signature:input.sourceSignature,callerWallet:input.callerWallet,
  mint:input.mint,receivedRaw:received.toString(),slot:tx.slot,
  feeAndSwapDebitProven:false,marketCapVerified:false,
  pumpQuoteProven:false,manualExitVerified:false,
  canSign:false,canBroadcast:false};
}
