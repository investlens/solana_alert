/** Package-backed PumpSwap SDK adapter for the isolated read-only signer.
 * Load only from the service's OWN installed dependency tree, not a URL or
 * coordinator-supplied module path. Fail closed if the official SDK/BN are
 * not installed; do not install dynamically or make a network request.
 *
 * Shipping this adapter is NOT approval for trading. Before production use,
 * pin the reviewed SDK version and lockfile integrity in the isolated image.
 */
import type {Connection} from '@solana/web3.js';
import type {EchoOfficialPumpSdkAdapter} from './signerOwnedOfficialPumpQuote.js';
export const ECHO_PACKAGE_BACKED_SDK_CAN_TRADE=false as const;
export async function loadSignerOwnedOfficialPumpSdk(
 connection:Connection
):Promise<EchoOfficialPumpSdkAdapter|null>{
 try{
  // Variable specifiers permit a fail-closed optional runtime dependency
  // without making the normal alert-only application's npm ci fail.
  // The official @pump-fun/pump-sdk/swap package must be separately reviewed
  // and pinned before the real isolated signer image includes it.
  const specifier:string='@pump-fun/pump-sdk/swap';
  const bnSpecifier:string='bn.js';
  const pkg=await import(specifier) as Record<string,any>;
  const bn=await import(bnSpecifier) as Record<string,any>;
  const BN=bn.default??bn;
  if(typeof pkg.OnlinePumpAmmSdk!=='function'||
     typeof pkg.PUMP_AMM_SDK?.decodePool!=='function'||
     typeof pkg.PUMP_AMM_SDK?.multiHopSwapInstructions!=='function'||
     typeof pkg.multiHopSwapQuote!=='function'||typeof BN!=='function')
   return null;
  const online=new pkg.OnlinePumpAmmSdk(connection);
  if(typeof online.multiHopPoolHops!=='function')return null;
  return {
   multiHopPoolHops:pools=>online.multiHopPoolHops(pools),
   decodePool:account=>pkg.PUMP_AMM_SDK.decodePool(account),
   quote:input=>pkg.multiHopSwapQuote(input),
   swapInstructions:input=>pkg.PUMP_AMM_SDK.multiHopSwapInstructions(input),
   amount:value=>new BN(value)
  } as EchoOfficialPumpSdkAdapter;
 }catch{return null;}
}
