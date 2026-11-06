/** Read-only production-wallet custody gate. Caller supplies an isolated signer
 * provider; this function neither imports wallet secrets nor signs transactions.
 * A test-generated key cannot prove custody of the pinned Echo wallet.
 * Every invocation uses a fresh random challenge via probeEchoSignerCustody.
 */
import {ECHO_EXPECTED_EXECUTION_WALLET} from './executionWallet.js';
import {probeEchoSignerCustody,type EchoCustodyProofProvider}
 from './isolatedCustodyProbe.js';
export const ECHO_CONFIGURED_WALLET_PROOF_ENABLES_TRADING=false as const;
export type EchoConfiguredCustodyResult=
 | {verified:true;wallet:string;mode:'OFFCHAIN_KEY_POSSESSION_ONLY';executionAuthorized:false}
 | {verified:false;reason:string;executionAuthorized:false};
export async function verifyEchoConfiguredWalletCustody(
 signer:EchoCustodyProofProvider,nowMs=Date.now()
):Promise<EchoConfiguredCustodyResult>{
 const result=await probeEchoSignerCustody({
  provider:signer,expectedWallet:ECHO_EXPECTED_EXECUTION_WALLET,
  audience:'echo-isolated-signer',nowMs
 });
 if('reason' in result)return {verified:false,reason:result.reason,executionAuthorized:false};
 return {verified:true,wallet:result.wallet,mode:'OFFCHAIN_KEY_POSSESSION_ONLY',
  executionAuthorized:false};
}
