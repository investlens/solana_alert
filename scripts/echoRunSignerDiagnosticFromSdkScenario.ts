/** Consume only the locally generated official-SDK unsigned scenario.
 * This job runs in disposable CI with NO private keys, no signing and no send.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
import {runEchoSignerNoBroadcastTest}
 from './echoSignerNoBroadcastTestOnce.js';

const file='.echo-isolated-unsigned-payload.json';
const fail=(reason:string)=>{
 process.stdout.write('ECHO_SIGNER_DIAGNOSTIC='+JSON.stringify({
  status:'BLOCKED',reason,signingAllowed:false,broadcastAllowed:false})+'\n');
 process.exitCode=2;
};
try{
 const x=JSON.parse(readFileSync(file,{encoding:'utf8',flag:'r'})) as
  Record<string,unknown>;
 const hex=/^[0-9a-f]{64}$/;
 const natural=/^[1-9][0-9]{0,17}$/;
 const str=(name:string)=>typeof x[name]==='string'?x[name] as string:'';
 const b64=str('unsignedBase64');
 const bytes=Buffer.from(b64,'base64');
 if(x.version!==1||
    x.mode!=='EXACT_UNSIGNED_SDK_SCENARIO_NOT_EXECUTABLE'||
    x.wallet!==ECHO_EXPECTED_EXECUTION_WALLET||
    x.scenarioCpiAudited!==false||
    x.manualSellReserveVerified!==false||
    !hex.test(str('unsignedSha256'))||
    bytes.length<80||bytes.length>3072||
    bytes.toString('base64')!==b64||
    createHash('sha256').update(bytes).digest('hex')!==x.unsignedSha256||
    !natural.test(str('principalLamports'))||
    x.slippageBps!==1000)
  throw Error('UNTRUSTED_EXACT_UNSIGNED_SCENARIO');
 const env={
  ECHO_SIGNER_TEST_ONLY:'true',
  ECHO_SIGNER_BROADCAST_ENABLED:'false',
  ECHO_SIGNER_REQUESTS_ENABLED:'false',
  ECHO_SIGNER_MODE:'PROOF_ONLY',
  ECHO_SIGNER_EXPECTED_WALLET:ECHO_EXPECTED_EXECUTION_WALLET,
  ECHO_SIGNER_TEST_RPC_URL:'https://api.mainnet-beta.solana.com',
  ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64:b64,
  ECHO_SIGNER_TEST_FIRST_POOL:str('firstPool'),
  ECHO_SIGNER_TEST_SECOND_POOL:str('secondPool'),
  ECHO_SIGNER_TEST_INTERMEDIATE_MINT:str('intermediateMint'),
  ECHO_SIGNER_TEST_TARGET_MINT:str('targetMint'),
  ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS:str('principalLamports'),
  ECHO_SIGNER_TEST_SLIPPAGE_BPS:'1000'
 };
 const r=await runEchoSignerNoBroadcastTest(env);
 process.stdout.write('ECHO_SIGNER_DIAGNOSTIC='+JSON.stringify(r)+'\n');
 // A BLOCKED result is evidence of no approval, not an accepted BUY.
 // The CI job may finish successfully for a correctly observed unfunded
 // wallet, but all trade activation gates remain blocked.
 if(r.reason.startsWith('PINNED_OFFICIAL_PUMP_SDK_NOT_INSTALLED')||
    r.reason.startsWith('OFFICIAL_POOL_OR_QUOTE_'))
  process.exitCode=2;
}catch{fail('SCENARIO_MISSING_OR_INVALID');}
