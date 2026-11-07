import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,ComputeBudgetProgram,TransactionMessage,
 VersionedTransaction} from '@solana/web3.js';
import {runEchoSignerNoBroadcastTest,ECHO_TEST_RUNNER_CAN_BROADCAST,
 ECHO_TEST_RUNNER_CAN_SIGN} from '../scripts/echoSignerNoBroadcastTestOnce.js';
const wallet=new PublicKey('8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ');
const tx=new VersionedTransaction(new TransactionMessage({
 payerKey:wallet,recentBlockhash:Keypair.generate().publicKey.toBase58(),
 instructions:[ComputeBudgetProgram.setComputeUnitLimit({units:300000})]
}).compileToV0Message()).serialize();
const env={
 ECHO_SIGNER_TEST_ONLY:'true',
 ECHO_SIGNER_BROADCAST_ENABLED:'false',
 ECHO_SIGNER_REQUESTS_ENABLED:'false',
 ECHO_SIGNER_MODE:'PROOF_ONLY',
 ECHO_SIGNER_EXPECTED_WALLET:wallet.toBase58(),
 ECHO_SIGNER_TEST_RPC_URL:'https://api.mainnet-beta.solana.com',
 ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64:Buffer.from(tx).toString('base64'),
 ECHO_SIGNER_TEST_FIRST_POOL:Keypair.generate().publicKey.toBase58(),
 ECHO_SIGNER_TEST_SECOND_POOL:Keypair.generate().publicKey.toBase58(),
 ECHO_SIGNER_TEST_INTERMEDIATE_MINT:Keypair.generate().publicKey.toBase58(),
 ECHO_SIGNER_TEST_TARGET_MINT:Keypair.generate().publicKey.toBase58(),
 ECHO_SIGNER_TEST_PRINCIPAL_LAMPORTS:'20000000',
 ECHO_SIGNER_TEST_SLIPPAGE_BPS:'1000'
};
const noConnect=()=>{throw Error('no test network access');};
test('test runner requires explicit OFF mode and sealed non-execution flags',async()=>{
 for(const change of [
  {ECHO_SIGNER_TEST_ONLY:'false'},
  {ECHO_SIGNER_BROADCAST_ENABLED:'true'},
  {ECHO_SIGNER_REQUESTS_ENABLED:'true'},
  {ECHO_SIGNER_MODE:'EXECUTE'},
  {ECHO_SIGNER_EXPECTED_WALLET:Keypair.generate().publicKey.toBase58()}
 ]){
  const r=await runEchoSignerNoBroadcastTest({...env,...change},noConnect);
  assert.equal(r.reason,'TEST_ONLY_BROADCAST_AND_CUSTODY_GUARDS_REQUIRED');
  assert.equal(r.broadcastAllowed,false);
 }
 assert.equal(ECHO_TEST_RUNNER_CAN_SIGN,false);
 assert.equal(ECHO_TEST_RUNNER_CAN_BROADCAST,false);
});
test('missing pinned RPC or exact message fails before network setup',async()=>{
 for(const change of [
  {ECHO_SIGNER_TEST_RPC_URL:'http://localhost:8899'},
  {ECHO_SIGNER_TEST_RPC_URL:'https://127.0.0.1/'},
  {ECHO_SIGNER_TEST_RPC_URL:'https://169.254.1.5/'},
  {ECHO_SIGNER_TEST_UNSIGNED_TX_BASE64:'not-a-transaction!'},
  {ECHO_SIGNER_TEST_TARGET_MINT:'garbage'},
  {ECHO_SIGNER_TEST_SLIPPAGE_BPS:'1001'}
 ]){
  const r=await runEchoSignerNoBroadcastTest({...env,...change},noConnect);
  assert.equal(r.status,'BLOCKED',JSON.stringify(change));
  assert.equal(r.signingAllowed,false);
 }
});
test('unsigned exact transaction never triggers signing or network sending',async()=>{
 let initiated=0;
 const r=await runEchoSignerNoBroadcastTest(env,()=>{initiated++;return noConnect();});
 assert.equal(initiated,1);
 assert.equal(r.reason,'RPC_CONNECTION_CONFIG_FAILED');
 assert.equal(r.signingAllowed,false);
 assert.equal(r.broadcastAllowed,false);
 assert.equal(r.completeCpiAndTokenEffectsVerified,false);
 assert.equal(r.manualPhantomExitVerified,false);
});
