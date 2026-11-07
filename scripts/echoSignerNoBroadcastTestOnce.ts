/** Owner-invoked, ONE-SHOT, isolated PumpSwap proof runner.
 * Does not load ANY signer key, serve HTTP, create reservations, sign or send.
 * Requires a pre-built exact unsigned message supplied solely via an
 * operator-controlled, test-only environment. No Telegram event payloads.
 * Intended for a disposable signer TEST service, never the alert service.
 */
import {createHash} from 'node:crypto';
import {Connection,VersionedTransaction,PublicKey} from '@solana/web3.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
import {probeSignerOwnedPumpRpc} from '../src/echo/signerOwnedPumpRpcProbe.js';
import {inspectSignerOwnedOfficialPumpQuote}
 from '../src/echo/signerOwnedOfficialPumpQuote.js';
import {loadSignerOwnedOfficialPumpSdk}
 from '../src/echo/loadSignerOwnedOfficialPumpSdk.js';

export const ECHO_TEST_RUNNER_CAN_SIGN=false as const;
export const ECHO_TEST_RUNNER_CAN_BROADCAST=false as const;
type Env=Record<string,string|undefined>;
export type EchoTestRunnerResult={
 mode:'NO_BROADCAST_SIGNER_RPC_TEST';
 status:'BLOCKED'|'PROVISIONAL';
 reason:string;exactMessageHashVerified:boolean;
 poolAndQuoteVerified:boolean;
 simulatedWalletProvisional:boolean;
 completeCpiAndTokenEffectsVerified:false;
 manualPhantomExitVerified:false;
 signingAllowed:false;broadcastAllowed:false;
};
const result=(reason:string,hash=false,quote=false,sim=false):EchoTestRunnerResult=>({
 mode:'NO_BROADCAST_SIGNER_RPC_TEST',
 status:sim&&quote?'PROVISIONAL':'BLOCKED',reason,
 exactMessageHashVerified:hash,poolAndQuoteVerified:quote,
 simulatedWalletProvisional:sim,
 completeCpiAndTokenEffectsVerified:false,
 manualPhantomExitVerified:false,
 signingAllowed:false,broadcastAllowed:false
});
const address=(s:string|undefined)=>typeof s==='string'&&
 /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const urlAllowed=(s:string|undefined)=>typeof s==='string'&&
 /^https:\/\/[A-Za-z0-9.-]+(?::443)?(?:\/[A-Za-z0-9/_?=&%.-]*)?$/.test(s)&&
 !/\b(localhost|127\.0\.0\.1|0\.0\.0\.0|169\.254\.|192\.168\.|10\.)\b/.test(s);

export async function runEchoSignerNoBroadcastTest(
 env:Env,createConnection:(url:string)=>Connection=url=>new Connection(url,'confirmed')
):Promise<EchoTestRunnerResult>{
 // This is deliberately not an implicit environment-trading ON switch.
 if(env.ECHO_SIGNER_TEST_ONLY!=='true'||
    env.ECHO_SIGNER_BROADCAST_ENABLED!=='false'||
    env.ECHO_SIGNER_REQUESTS_ENABLED!=='false'||
    env.ECHO_SIGNER_MODE!=='PROOF_ONLY'||
    env.ECHO_SIGNER_EXPECTED_WALLET!==ECHO_EXPECTED_EXECUTION_WALLET)
  return result('TEST_ONLY_BROADCAST_AND_CUSTODY_GUARDS_REQUIRED');
 if(!urlAllowed(env.ECHO_SIGNER_TEST_RPC_URL))
  return result('PINNED_HTTPS_RPC_ENDPOINT_REQUIRED');
 if(!env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64||
    env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64.length>8192||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64))
  return result('EXACT_UNSIGNED_TRANSACTION_REQUIRED');
 if(!address(env.ECHO_SIGNER_TEST_FIRST_POOL)||
    !address(env.ECHO_SIGNER_TEST_SECOND_POOL)||
    !address(env.ECHO_SIGNER_TEST_INTERMEDIATE_MINT)||
    !address(env.ECHO_SIGNER_TEST_TARGET_MINT)||
    !/^[1-9][0-9]{0,17}$/.test(env.ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS??'')||
    !/^(?:[1-9][0-9]{0,3})$/.test(env.ECHO_SIGNER_TEST_SLIPPAGE_BPS??''))
  return result('COMPLETE_OFFICIAL_ROUTE_CONFIG_REQUIRED');
 let bytes:Buffer,tx:VersionedTransaction,sha:string;
 try{
  bytes=Buffer.from(env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64,'base64');
  if(bytes.length<80||bytes.length>3072||
     bytes.toString('base64')!==env.ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64)
   return result('NONCANONICAL_OR_OVERSIZED_MESSAGE');
  sha=createHash('sha256').update(bytes).digest('hex');
  tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.version!==0||tx.message.addressTableLookups.length!==0||
     tx.message.header.numRequiredSignatures!==1||
     tx.signatures.length!==1||tx.signatures[0].some(b=>b!==0)||
     tx.message.staticAccountKeys[0]?.toBase58()!==ECHO_EXPECTED_EXECUTION_WALLET)
   return result('WRONG_FEE_PAYER_OR_NOT_UNSIGNED');
 }catch{return result('UNREADABLE_EXACT_UNSIGNED_MESSAGE');}
 let connection:Connection;
 try{connection=createConnection(env.ECHO_SIGNER_TEST_RPC_URL!);}
 catch{return result('RPC_CONNECTION_CONFIG_FAILED',true);}
 const sdk=await loadSignerOwnedOfficialPumpSdk(connection);
 if(!sdk)return result('PINNED_OFFICIAL_PUMP_SDK_NOT_INSTALLED',true);
 const quote=await inspectSignerOwnedOfficialPumpQuote({
  rpc:connection,sdk,unsignedBytes:bytes,expectedUnsignedSha256:sha!,
  firstPool:env.ECHO_SIGNER_TEST_FIRST_POOL!,
  secondPool:env.ECHO_SIGNER_TEST_SECOND_POOL!,
  intermediateMint:env.ECHO_SIGNER_TEST_INTERMEDIATE_MINT!,
  targetMint:env.ECHO_SIGNER_TEST_TARGET_MINT!,
  principalLamports:env.ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS!,
  slippageBps:Number(env.ECHO_SIGNER_TEST_SLIPPAGE_BPS)
 });
 if(!quote.ok)return result('OFFICIAL_POOL_OR_QUOTE_'+quote.reason,true);
 const rpc=await probeSignerOwnedPumpRpc({
  connection,unsignedBytes:bytes,expectedUnsignedSha256:sha!,nowMs:Date.now()
 });
 if(!rpc.ok)return result('EXACT_WALLET_SIMULATION_'+rpc.reason,true,true);
 // A successful RPC probe remains PROVISIONAL. No real Phantom exit or
 // complete CPI/token ledger has been checked by this one-shot diagnostic.
 return result('PROVISIONAL_RPC_SIMULATION_NOT_LIVE_APPROVAL',true,true,true);
}

// Opt-in command only. Imported tests never start the job.
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const status=await runEchoSignerNoBroadcastTest(process.env);
 process.stdout.write('ECHO_NO_BROADCAST_SIGNER_TEST='+JSON.stringify(status)+'\n');
 if(status.status==='BLOCKED')process.exitCode=2;
}
