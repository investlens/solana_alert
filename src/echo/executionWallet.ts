/** Public wallet identity gate. Never accepts or stores private keys. */
import { PublicKey } from '@solana/web3.js';
export const ECHO_EXPECTED_EXECUTION_WALLET = '8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
export function verifyEchoExecutionWallet(signerPublicKey:string,expectedWallet=ECHO_EXPECTED_EXECUTION_WALLET):boolean {
 try {
  const signer=new PublicKey(signerPublicKey);
  const expected=new PublicKey(expectedWallet);
  return signer.toBase58()===expected.toBase58() && signer.isOnCurve();
 } catch { return false; }
}
/** Fail closed before any signing, quote submission or Telegram action. */
export function assertEchoExecutionWallet(signerPublicKey:string):void {
 if(!verifyEchoExecutionWallet(signerPublicKey))throw Error('ECHO_EXECUTION_WALLET_MISMATCH');
}
