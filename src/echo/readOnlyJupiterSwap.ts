import { VersionedTransaction, PublicKey, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { simulateEchoUnsignedTransaction } from './readOnlySimulation.js';
/** Fetch a Jupiter quote and unsigned transaction for read-only validation.
 * This NEVER signs, transmits, or broadcasts transactions.
 * Private signing keys are not accepted by this module.
 */
export type EchoSwapSimulationRequest={
  rpcUrl:string; publicWallet:string; outputMint:string;
  amountLamports:number; maxSlippageBps:number; jupiterApiKey:string;
};
const addr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL='So11111111111111111111111111111111111111112';
const api='https://api.jup.ag/swap/v1';
type Requester=typeof fetch;
export async function readOnlyJupiterSwapPreview(request:EchoSwapSimulationRequest,
  fetcher:Requester=fetch):Promise<{ok:boolean;reason:string;simulationLogs?:string[]}>{
  if(!addr.test(request.publicWallet)||!addr.test(request.outputMint)||request.outputMint===SOL||
    !Number.isSafeInteger(request.amountLamports)||request.amountLamports<=0||
    request.amountLamports>100_000_000||
    !Number.isSafeInteger(request.maxSlippageBps)||request.maxSlippageBps<1||
    request.maxSlippageBps>300||!request.jupiterApiKey?.trim())
    return {ok:false,reason:'INVALID_PREVIEW_PARAMS'};
  // An unsigned transaction can be simulated, not signed or sent.
  try{
    const headers={'x-api-key':request.jupiterApiKey,accept:'application/json'};
    const q=new URL(api+'/quote');
    q.searchParams.set('inputMint',SOL);
    q.searchParams.set('outputMint',request.outputMint);
    q.searchParams.set('amount',String(request.amountLamports));
    q.searchParams.set('slippageBps',String(request.maxSlippageBps));
    q.searchParams.set('restrictIntermediateTokens','true');
    const quoteRes=await fetcher(q.toString(),{headers,signal:AbortSignal.timeout(5000)});
    if(!quoteRes.ok)return {ok:false,reason:'QUOTE_UNAVAILABLE'};
    const quote=await quoteRes.json();
    if(quote.inputMint!==SOL||quote.outputMint!==request.outputMint||
       quote.inAmount!==String(request.amountLamports)||!Array.isArray(quote.routePlan)||
       !quote.routePlan.length)return {ok:false,reason:'QUOTE_MISMATCH'};
    const swapRes=await fetcher(api+'/swap',{method:'POST',headers:{...headers,'content-type':'application/json'},
      signal:AbortSignal.timeout(5000),
      body:JSON.stringify({quoteResponse:quote,userPublicKey:request.publicWallet,
        wrapAndUnwrapSol:true,dynamicComputeUnitLimit:true,
        prioritizationFeeLamports:0})});
    if(!swapRes.ok)return {ok:false,reason:'SWAP_BUILDER_UNAVAILABLE'};
    const swap=await swapRes.json();
    if(typeof swap.swapTransaction!=='string'||swap.swapTransaction.length>3000)
      return {ok:false,reason:'INVALID_UNSIGNED_TRANSACTION'};
    const bytes=Buffer.from(swap.swapTransaction,'base64');
    const tx=VersionedTransaction.deserialize(bytes);
    const keys=tx.message.staticAccountKeys;
    if(!keys.length||keys[0].toBase58()!==request.publicWallet||
       tx.signatures.length!==1||
       !tx.signatures.every(s=>s.every(b=>b===0)))
      return {ok:false,reason:'UNTRUSTED_TRANSACTION_SIGNERS'};
    // Reject lookup tables until addresses can be resolved and independently
    // classified. Compiled indexes alone cannot establish the programs invoked.
    if (tx.message.addressTableLookups.length !== 0)
      return {ok:false,reason:'UNRESOLVED_LOOKUP_TABLES'};
    if (tx.message.header.numRequiredSignatures !== 1)
      return {ok:false,reason:'UNTRUSTED_TRANSACTION_SIGNERS'};
    // Conservative read-only preview policy. This is NOT authorization to sign.
    // Future swap paths require full account-level and instruction-level audit.
    const permittedPrograms = new Set([
      ComputeBudgetProgram.programId.toBase58(),
      SystemProgram.programId.toBase58(),
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
      'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5KBWH9r',
    ]);
    for (const instruction of tx.message.compiledInstructions) {
      const program = keys[instruction.programIdIndex]?.toBase58();
      if (!program || !permittedPrograms.has(program))
        return {ok:false,reason:'UNREVIEWED_SWAP_PROGRAM'};
      // SystemProgram::Transfer is discriminator 2 (little endian u32).
      // It must not be accepted as a purported swap.
      if (program === SystemProgram.programId.toBase58() &&
          instruction.data.length >= 4 && Buffer.from(instruction.data).readUInt32LE(0) === 2)
        return {ok:false,reason:'UNEXPECTED_SOL_TRANSFER'};
    }
    // Preflight transaction bytes only. Never invoke any signing or send RPC.
    const result=await simulateEchoUnsignedTransaction(request.rpcUrl,swap.swapTransaction,fetcher);
    return {ok:result.ok,reason:result.reason,simulationLogs:result.logs};
  }catch{return {ok:false,reason:'PREVIEW_BUILD_OR_SIMULATION_UNAVAILABLE'};}
}
export const ECHO_SWAP_BROADCAST_ENABLED=false as const;
