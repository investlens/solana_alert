/** OPT-IN, LOCAL-ONLY diagnostic for an existing legacy signing key.
 * Never run in the live alert worker and never deploy automatically.
 * This is NOT an isolated signer and NEVER authorizes live trading.
 * An operator who already has authorized access may run this manually INSIDE
 * the trusted, secure runtime. Never paste or export the secret into chat.
 * Only non-sensitive MATCH/MISMATCH/UNAVAILABLE status is output.
 */
import {createPrivateKey,sign as signEd25519} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair} from '@solana/web3.js';
import {probeEchoSignerCustody} from '../src/echo/isolatedCustodyProbe.js';
import {ECHO_EXPECTED_EXECUTION_WALLET} from '../src/echo/executionWallet.js';

export type EchoLegacyKeyCheckResult=
 | {status:'MATCH';authorizesTrading:false}
 | {status:'MISMATCH';authorizesTrading:false}
 | {status:'UNAVAILABLE';authorizesTrading:false};

export async function checkEchoLegacyKeyBinding(args:{
 secretBase58?:string; expectedWallet:string;nowMs:number;
}):Promise<EchoLegacyKeyCheckResult>{
 // This code must never log/return the key, signed message, or a signature.
 if(!args.secretBase58||args.secretBase58.length>256)
  return {status:'UNAVAILABLE',authorizesTrading:false};
 try{
  const secret=bs58.decode(args.secretBase58);
  if(secret.length!==64)return {status:'UNAVAILABLE',authorizesTrading:false};
  const keypair=Keypair.fromSecretKey(secret);
  // Fast mismatch check before any cryptographic signing.
  if(keypair.publicKey.toBase58()!==args.expectedWallet)
   return {status:'MISMATCH',authorizesTrading:false};
  const der=Buffer.concat([
   Buffer.from('302e020100300506032b657004220420','hex'),
   Buffer.from(keypair.secretKey.slice(0,32))
  ]);
  const key=createPrivateKey({key:der,format:'der',type:'pkcs8'});
  const result=await probeEchoSignerCustody({
   provider:{publicWallet:keypair.publicKey.toBase58(),
    signOwnershipMessage:async(bytes)=>new Uint8Array(signEd25519(null,Buffer.from(bytes),key))},
   expectedWallet:args.expectedWallet,audience:'echo-isolated-signer',
   nowMs:args.nowMs
  });
  return {status:result.verified?'MATCH':'UNAVAILABLE',authorizesTrading:false};
 }catch{return {status:'UNAVAILABLE',authorizesTrading:false};}
}

/** Manual CLI entrypoint; never invoked from the service startup path. */
if(process.argv[1]?.endsWith('echoCheckLegacyWalletBinding.ts')){
 const result=await checkEchoLegacyKeyBinding({
  secretBase58:process.env.ADMIN_TRADING_PRIVATE_KEY,
  expectedWallet:ECHO_EXPECTED_EXECUTION_WALLET,nowMs:Date.now()
 });
 // No addresses, keys, signatures or signed messages are logged.
 process.stdout.write('ECHO_LEGACY_WALLET_BINDING='+result.status+';TRADING=OFF\n');
 if(result.status!=='MATCH')process.exitCode=2;
}
