/** Exact unsigned transaction simulation with compiled CPI indexing.
 * The web3.js v1 Connection.simulateTransaction convenience wrapper does not
 * reliably forward innerInstructionsEncoding; use its existing pinned RPC
 * transport for this ONE read-only method, with explicit reviewed arguments.
 * Do not log response bodies or the base64 transaction.
 */
import {Connection,VersionedTransaction} from '@solana/web3.js';
import type {EchoSignerRpcReadOnly} from './signerOwnedPumpRpcProbe.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
export const ECHO_COMPILED_CPI_SIMULATOR_CAN_SIGN=false as const;
export const ECHO_COMPILED_CPI_SIMULATOR_CAN_BROADCAST=false as const;
type SimConfig=Parameters<EchoSignerRpcReadOnly['simulateTransaction']>[1];
type SimResult=Awaited<ReturnType<EchoSignerRpcReadOnly['simulateTransaction']>>;
type RpcResponse={error?:unknown;result?:unknown};
type RpcTransport={_rpcRequest(method:string,args:unknown[]):Promise<RpcResponse>};
export async function simulateSignerCompiledCpiOnPinnedRpc(
 connection:Connection,tx:VersionedTransaction,config:SimConfig
):Promise<SimResult>{
 if(config.sigVerify!==false||config.replaceRecentBlockhash!==false||
    config.commitment!=='confirmed'||config.innerInstructions!==true||
    config.innerInstructionsEncoding!=='json'||
    !Number.isSafeInteger(config.minContextSlot)||config.minContextSlot<=0||
    config.accounts?.encoding!=='base64'||
    config.accounts.addresses.length!==1||
    config.accounts.addresses[0]!==ECHO_EXPECTED_EXECUTION_WALLET||
    tx.message.version!==0||tx.message.addressTableLookups.length!==0||
    tx.message.header.numRequiredSignatures!==1||
    tx.signatures.length!==1||tx.signatures[0].some(x=>x!==0)||
    tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET||
    tx.serialize().length>1232)
  throw Error('UNTRUSTED_COMPILED_CPI_SIMULATION_ARGUMENTS');
 const transport=connection as unknown as RpcTransport;
 if(typeof transport._rpcRequest!=='function')
  throw Error('PINNED_SOLANA_RPC_TRANSPORT_UNAVAILABLE');
 const rpc=await transport._rpcRequest('simulateTransaction',[
  Buffer.from(tx.serialize()).toString('base64'),
  {encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,
   commitment:'confirmed',minContextSlot:config.minContextSlot,
   innerInstructions:true,innerInstructionsEncoding:'json',
   accounts:{encoding:'base64',addresses:[ECHO_EXPECTED_EXECUTION_WALLET]}}
 ]);
 if(!rpc||typeof rpc!=='object'||rpc.error||!rpc.result||
    typeof rpc.result!=='object')
  throw Error('COMPILED_CPI_SIMULATION_RPC_FAILED');
 const raw=rpc.result as Record<string,unknown>;
 if(!raw.context||typeof raw.context!=='object'||
    !Number.isSafeInteger((raw.context as Record<string,unknown>).slot)||
    !raw.value||typeof raw.value!=='object')
  throw Error('INVALID_COMPILED_CPI_SIMULATION_RESPONSE');
 // The caller independently validates all accounts and every CPI index.
 return raw as unknown as SimResult;
}
