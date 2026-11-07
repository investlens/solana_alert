/** Consume only the locally generated official-SDK unsigned scenario.
 * This job runs in disposable CI with NO private keys, no signing and no send.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';
import {evaluateEchoPilotNoRefundBudget}
 from '../src/echo/signerOwnedPilotNoRefundCostGate.js';
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
    x.slippageBps!==1000||
    (x.scenarioAllInCents!==250&&x.scenarioAllInCents!==500)||
    !natural.test(str('publicFxUpperCents'))||
    x.publicFxConsensusOnly!==true)
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
 const diagnostic=r.payerDebitMismatchDiagnostic;
 // The provisional ledger upper already includes network fee; convert
 // it back to reconstructed outgoing before applying the fee exactly once.
 const feeInput=diagnostic?.networkFeeLamports??
  r.provisionalNetworkFeeLamports;
 const upperInput=diagnostic?.outboundSystemDebitsLamports ??
  (r.provisionalWalletDebitUpperLamports&&feeInput&&
   BigInt(r.provisionalWalletDebitUpperLamports)>BigInt(feeInput)?
   String(BigInt(r.provisionalWalletDebitUpperLamports)-BigInt(feeInput)):undefined);
 const diagnosticBudget=upperInput?evaluateEchoPilotNoRefundBudget({
  scenarioCapCents:x.scenarioAllInCents as 250|500,
  solUsdUpperCents:str('publicFxUpperCents'),
  reconstructedOutboundLamports:upperInput,
  independentlyQuotedNetworkFeeLamports:feeInput??'0'
 }):null;
 // A quote-only budget check is not a signed exchange oracle and
 // cannot override any signer or full CPI verification failure.
 const budgetPassed=diagnosticBudget?.status==='CONSERVATIVE_UPPER_WITHIN_SCENARIO_CAP';
 const output={...r,
  ...(!budgetPassed&&r.status==='PROVISIONAL'?{status:'BLOCKED' as const,
   reason:'PILOT_NO_REFUND_ALL_IN_CAP_NOT_VERIFIED'}:{}),
  ...(diagnosticBudget?{pilotNoRefundBudgetDiagnostic:diagnosticBudget}:{})};
 process.stdout.write('ECHO_SIGNER_DIAGNOSTIC='+JSON.stringify(output)+'\n');
 // A blocked funded-state simulation MUST produce a failing CI job,
 // including when the wallet is unfunded. Never convert diagnostic failure
 // into a green release gate or unconditionally swallow RPC errors.
 if(output.status!=='PROVISIONAL')process.exitCode=2;
}catch{fail('SCENARIO_MISSING_OR_INVALID');}
