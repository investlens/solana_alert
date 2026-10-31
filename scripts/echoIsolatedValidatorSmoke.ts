/**
 * Local-only Solana validator smoke probe.
 *
 * Requires a separately started solana-test-validator on loopback:8899.
 * Creates ephemeral test-only keypairs, requests valueless local test SOL,
 * builds an UNSIGNED transfer and calls simulateTransaction only.
 * It does not execute a BUY or SELL swap, prove route economics, sign
 * transaction bytes, or touch mainnet / Phantom / production infrastructure.
 */
import {Connection,Keypair,PublicKey,SystemProgram,TransactionMessage,
 VersionedTransaction} from '@solana/web3.js';
import {createHash} from 'node:crypto';
const ENDPOINT='http://127.0.0.1:8899';
const connection=new Connection(ENDPOINT,'confirmed');
async function main(){
 const payer=Keypair.generate();
 const dest=Keypair.generate().publicKey;
 const genesis=await connection.getGenesisHash();
 const airdrop=await connection.requestAirdrop(payer.publicKey,2_000_000_000);
 const confirmed=await connection.confirmTransaction(airdrop,'confirmed');
 if(confirmed.value.err)throw Error('LOCAL_AIRDROP_NOT_CONFIRMED');
 const before=await connection.getBalance(payer.publicKey,'confirmed');
 if(before<1_000_000_000)throw Error('LOCAL_TEST_FUNDS_MISSING');
 const blockhash=await connection.getLatestBlockhash('confirmed');
 const message=new TransactionMessage({
  payerKey:payer.publicKey,recentBlockhash:blockhash.blockhash,
  instructions:[SystemProgram.transfer({
   fromPubkey:payer.publicKey,toPubkey:dest,lamports:10_000_000
  })]
 }).compileToV0Message();
 const tx=new VersionedTransaction(message); // signatures remain all zeros
 if(tx.signatures.length!==1||!tx.signatures[0].every(b=>b===0))
  throw Error('UNSIGNED_ENVELOPE_REQUIRED');
 const simulation=await connection.simulateTransaction(tx,{
  sigVerify:false,replaceRecentBlockhash:true,commitment:'confirmed'
 });
 if(simulation.value.err)throw Error('LOCAL_READ_ONLY_SIMULATION_FAILED');
 const bytes=Buffer.from(tx.serialize());
 process.stdout.write(JSON.stringify({
  environment:'ISOLATED_LOOPBACK_VALIDATOR',genesisHash:genesis,
  publicTestPayer:payer.publicKey.toBase58(),
  publicTestDestination:dest.toBase58(),
  fixtureLamports:10_000_000,
  unsignedTransactionSha256:createHash('sha256').update(bytes).digest('hex'),
  readOnlySimulation:'PASSED',signed:false,swapExecuted:false,
  broadcastedSwap:false,productionApproval:false
 })+'\n');
}
main().catch(e=>{
 process.stderr.write(JSON.stringify({
  environment:'ISOLATED_LOOPBACK_VALIDATOR',success:false,
  reason:e instanceof Error?e.message:'UNKNOWN',productionApproval:false
 })+'\n');
 process.exitCode=1;
});
