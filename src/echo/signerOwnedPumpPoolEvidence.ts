/** Signer-owned PumpSwap account provenance from an endpoint-pinned RPC.
 * No transaction signer, signing method, transaction submission or private key.
 *
 * Validates a genuine on-chain pool owner, target mint owner and fresh slot
 * against the exact SDK-generated unsigned bytes. The pool->mint layout is
 * NOT decoded here, so this result must never assert fee/route/CPI/SELL proof.
 */
import {createHash} from 'node:crypto';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {probeSignerOwnedPumpRpc,
 type EchoSignerRpcReadOnly,type EchoSignerRpcProbeResult} from './signerOwnedPumpRpcProbe.js';
import {reconcileEchoSignerPumpCpiLedger,
 type EchoCpiRawInnerGroup,type EchoSignerCpiLedger}
 from './signerOwnedPumpCpiAccounting.js';

export const ECHO_SIGNER_POOL_PROVENANCE_CAN_SIGN=false as const;
export const ECHO_SIGNER_POOL_PROVENANCE_CAN_BROADCAST=false as const;
export const PUMP_SWAP_PROGRAM_ID='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL='So11111111111111111111111111111111111111112';
const addr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export type EchoOwnedRpcAccount={
 owner:PublicKey;
 executable:boolean;
 data:Buffer|Uint8Array;
};
export type EchoSignerPoolRpc=EchoSignerRpcReadOnly&{
 getMultipleAccountsInfoAndContext(
  keys:PublicKey[],config:{commitment:'confirmed';minContextSlot:number}
 ):Promise<{context:{slot:number};value:(EchoOwnedRpcAccount|null)[]}>;
};
export type EchoSignerPoolEvidence={
 ok:true;mode:'ONCHAIN_POOL_AND_MINT_OWNER_OBSERVATION';
 unsignedSha256:string;slot:number;poolsObserved:number;
 targetMint:string;targetDecimals:number;
 simulatedWalletProbe:EchoSignerRpcProbeResult;
 payerCpiLedger:EchoSignerCpiLedger|null;
 poolMintContinuityProven:false;
 completeCpiEconomicsProven:false;
 phantomSellReserveProven:false;
 canSign:false;canBroadcast:false;
}|{ok:false;reason:string;canSign:false;canBroadcast:false};

const fail=(reason:string):EchoSignerPoolEvidence=>({
 ok:false,reason,canSign:false,canBroadcast:false
});

/** Pool addresses must be derived via official SDK from both swap mints by
 * the isolated server. Never accept addresses from Telegram or an untrusted
 * coordinator, and do NOT mistake ownership for pool-mint continuity.
 */
export async function inspectSignerOwnedPumpPoolEvidence(input:{
 connection:EchoSignerPoolRpc;
 unsignedBytes:Uint8Array;
 expectedUnsignedSha256:string;
 targetMint:string;
 /** Exactly the official SDK-derived pool(s) for this BUY. */
 sdkDerivedPools:readonly string[];
 nowMs:number;
}):Promise<EchoSignerPoolEvidence>{
 const {unsignedBytes:bytes,expectedUnsignedSha256:expected,nowMs}=input;
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    bytes.length<80||bytes.length>3072||
    !/^[0-9a-f]{64}$/.test(expected)||!addr.test(input.targetMint)||
    input.targetMint===WSOL||
    !Array.isArray(input.sdkDerivedPools)||
    input.sdkDerivedPools.length<1||input.sdkDerivedPools.length>2||
    new Set(input.sdkDerivedPools).size!==input.sdkDerivedPools.length||
    input.sdkDerivedPools.some(p=>!addr.test(p)||p===input.targetMint))
  return fail('INVALID_SIGNER_POOL_EVIDENCE_INPUT');
 const sha=createHash('sha256').update(bytes).digest('hex');
 if(sha!==expected)return fail('EXACT_UNSIGNED_TRANSACTION_MISMATCH');
 let tx:VersionedTransaction;
 try{tx=VersionedTransaction.deserialize(bytes);}
 catch{return fail('INVALID_UNSIGNED_TRANSACTION');}
 const msg=tx.message;
 if(msg.version!==0||msg.addressTableLookups.length!==0||
    msg.header.numRequiredSignatures!==1||tx.signatures.length!==1||
    tx.signatures[0].some(b=>b!==0)||
    msg.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
  return fail('WRONG_SIGNER_OR_UNREVIEWED_LOOKUP');
 const keys=msg.staticAccountKeys.map(k=>k.toBase58());
 const programIndex=keys.indexOf(PUMP_SWAP_PROGRAM_ID);
 if(programIndex<0||msg.compiledInstructions.filter(ix=>
    ix.programIdIndex===programIndex).length!==1)
  return fail('MISSING_OR_DUPLICATED_PUMPSWAP_INSTRUCTION');
 const swap=msg.compiledInstructions.find(ix=>ix.programIdIndex===programIndex)!;
 const referenced=new Set(Array.from(swap.accountKeyIndexes).map(i=>keys[i]));
 if(input.sdkDerivedPools.some(p=>!referenced.has(p))||
    !referenced.has(input.targetMint))
  return fail('PUMP_POOL_OR_TARGET_MINT_NOT_BOUND_TO_SWAP');
 // One RPC bank snapshot for all pool and mint owners. Do not accept
 // arbitrary externally supplied account-owner success flags.
 try{
  const inspected=await input.connection.getMultipleAccountsInfoAndContext(
   [...input.sdkDerivedPools,input.targetMint].map(k=>new PublicKey(k)),
   {commitment:'confirmed',minContextSlot:1}
  );
  if(!Number.isSafeInteger(inspected.context?.slot)||
     inspected.context.slot<=0||
     inspected.value.length!==input.sdkDerivedPools.length+1)
   return fail('STALE_OR_INCOMPLETE_POOL_ACCOUNT_SNAPSHOT');
  const poolAccounts=inspected.value.slice(0,-1);
  if(poolAccounts.some(p=>!p||p.executable||
       p.owner.toBase58()!==PUMP_SWAP_PROGRAM_ID||p.data.length<64))
   return fail('PUMP_POOL_NOT_OWNED_BY_OFFICIAL_PROGRAM');
  const mintAccount=inspected.value[inspected.value.length-1];
  if(!mintAccount||mintAccount.executable||
     ![TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(
      mintAccount.owner.toBase58())||
     mintAccount.data.length<82)
   return fail('TARGET_MINT_ACCOUNT_OWNER_OR_LAYOUT_INVALID');
  // SPL Mint's common 82-byte prefix has decimals at offset 44.
  const decimals=mintAccount.data[44];
  if(!Number.isInteger(decimals)||decimals>12)
   return fail('UNVERIFIED_TARGET_TOKEN_DECIMALS');
  // The local capture receives the SAME validated simulation made by the
  // signer-owned probe; do not re-fetch a different bank and pretend that
  // its balance/fee/inner instructions are one coherent result.
  const captured:{snapshot:null|{
   innerInstructions:unknown;payerBeforeLamports:number;
   payerAfterLamports:number;networkFeeLamports:number;simulationSlot:number
  }}={snapshot:null};
  const probe=await probeSignerOwnedPumpRpc({
   connection:input.connection,unsignedBytes:bytes,
   expectedUnsignedSha256:expected,nowMs,
   onValidatedSimulation:snapshot=>{captured.snapshot=snapshot;}
  });
  let payerCpiLedger:EchoSignerCpiLedger|null=null;
  if(probe.ok&&captured.snapshot){
   const observed=captured.snapshot;
   payerCpiLedger=reconcileEchoSignerPumpCpiLedger({
    unsignedBytes:bytes,expectedUnsignedSha256:expected,
    prePayerBalanceLamports:String(observed.payerBeforeLamports),
    postSimulatedPayerBalanceLamports:String(observed.payerAfterLamports),
    networkFeeLamports:String(observed.networkFeeLamports),
    innerInstructions:observed.innerInstructions as EchoCpiRawInnerGroup[]
   });
  }
  // A pool-owner observation may succeed with an unfunded wallet, but
  // the complete wallet simulation CANNOT be called successful.
  return {ok:true,mode:'ONCHAIN_POOL_AND_MINT_OWNER_OBSERVATION',
   unsignedSha256:sha,slot:inspected.context.slot,
   poolsObserved:poolAccounts.length,targetMint:input.targetMint,
   targetDecimals:decimals,simulatedWalletProbe:probe,
   payerCpiLedger,
   poolMintContinuityProven:false,
   completeCpiEconomicsProven:false,
   phantomSellReserveProven:false,
   canSign:false,canBroadcast:false};
 }catch{return fail('SIGNER_PINNED_RPC_ACCOUNT_READ_FAILED');}
}
