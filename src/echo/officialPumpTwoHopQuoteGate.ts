/** Read-only economic gate for first-party Pump two-hop exact-input BUY.
 * Never trusts quote metadata supplied by Telegram or the caller. Inputs must be
 * independently acquired from current pool/vault/fee accounts in the trusted
 * backend and checked AGAIN by the isolated signer before any signature.
 * This module cannot sign, send or authorize trading.
 */
export const ECHO_PUMP_TWO_HOP_TRADE_ENABLED=false as const;
export const ECHO_PUMP_FIRST_BUY_LAMPORTS=25_000_000n;
export const ECHO_PUMP_SLIPPAGE_CEILING_BPS=1000n;
const BPS=10_000n, LAMPORTS=1_000_000_000n;
const MINT_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const nat=(s:string):bigint|null=>
 typeof s==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(s)?BigInt(s):null;
export type EchoTwoHopFeeAwareQuote={
 wallet:string; inputMint:string; intermediateMint:string; outputMint:string;
 firstPool:string;secondPool:string;slippageBps:number;
 quotedOutputRaw:string; expectedOutputDecimals:number;
 inputLamports:string;
 /** All additional wallet lamports at risk, incl rent/ATA, venue, signature,
  * priority, routing and wrapping/unwrapping costs, conservatively bounded. */
 maxAdditionalLamports:string;
 /** Fresh independently verified SOL / USD quote in integer cents per SOL. */
 solUsdCentsPerSol:string;
 /** Quote and pool state must be bound to a fresh chain snapshot. */
 quoteObservedAtMs:number; nowMs:number;
 firstPoolVerified:boolean;secondPoolVerified:boolean;
 allFeeAccountsVerified:boolean;mintOwnersVerified:boolean;
 callerEntryPriceVerified:boolean;manualSellRouteVerified:boolean;
 /** Must be independently audited for exact message, including CPI debits
  * and all ATA/account-creation rent. A provisional RPC fee estimate is false. */
 fullWalletDebitVerified:boolean;
 /** Exact unsigned message must succeed with the actual dedicated-wallet state. */
 realWalletSimulationPassed:boolean;
};
export type EchoTwoHopQuoteResult=
 | {ok:true; executable:false;reason:'PRICE_AND_FEE_PREFLIGHT_ONLY';
   amountLamports:string;minOutputRaw:string;allInCents:string;
   maxTotalWalletDebitLamports:string}
 | {ok:false;executable:false;reason:string};
export function screenEchoTwoHopQuote(x:EchoTwoHopFeeAwareQuote):EchoTwoHopQuoteResult{
 const no=(reason:string):EchoTwoHopQuoteResult=>({ok:false,executable:false,reason});
 if(!x.firstPoolVerified||!x.secondPoolVerified||
  !x.allFeeAccountsVerified||!x.mintOwnersVerified||
  !x.callerEntryPriceVerified||!x.manualSellRouteVerified)
  return no('INDEPENDENT_POOL_FEES_OR_EXIT_PROOF_MISSING');
 if(x.fullWalletDebitVerified!==true)
  return no('FULL_WALLET_DEBIT_UNVERIFIED');
 if(x.realWalletSimulationPassed!==true)
  return no('REAL_WALLET_SIMULATION_REQUIRED');
 if(!MINT_RE.test(x.wallet)||!MINT_RE.test(x.intermediateMint)||
  !MINT_RE.test(x.outputMint)||!MINT_RE.test(x.firstPool)||!MINT_RE.test(x.secondPool)||
  x.inputMint!=='So11111111111111111111111111111111111111112'||
  x.intermediateMint===x.outputMint||x.firstPool===x.secondPool||
  x.intermediateMint===x.inputMint||x.outputMint===x.inputMint)
   return no('INVALID_ROUTE_IDENTIFIERS');
 if(!Number.isSafeInteger(x.nowMs)||!Number.isSafeInteger(x.quoteObservedAtMs)||
  x.quoteObservedAtMs>x.nowMs||x.nowMs-x.quoteObservedAtMs>2000)
  return no('STALE_OR_FUTURE_QUOTE');
 if(!Number.isSafeInteger(x.slippageBps)||x.slippageBps<1||
  BigInt(x.slippageBps)>ECHO_PUMP_SLIPPAGE_CEILING_BPS)
  return no('SLIPPAGE_ABOVE_CAP');
 if(!Number.isSafeInteger(x.expectedOutputDecimals)||x.expectedOutputDecimals<0||
  x.expectedOutputDecimals>12)return no('UNVERIFIED_TOKEN_DECIMALS');
 const input=nat(x.inputLamports),out=nat(x.quotedOutputRaw),
  fees=nat(x.maxAdditionalLamports),fx=nat(x.solUsdCentsPerSol);
 if(input===null||out===null||fees===null||fx===null||out===0n||fx===0n)
  return no('UNVERIFIED_INPUT_OUTPUT_OR_COST');
 if(input!==ECHO_PUMP_FIRST_BUY_LAMPORTS)return no('EXACT_0_025_SOL_REQUIRED');
 // Conservative: output is integer token atoms. Round minimum UP to
 // preserve the requested max slippage, never silently weaken the floor.
 const minOut=(out*(BPS-BigInt(x.slippageBps))+BPS-1n)/BPS;
 if(minOut===0n||minOut>out)return no('INVALID_MIN_OUTPUT');
 if(fees>10_000_000n)return no('UNEXPECTED_ADDITIONAL_SOL_COSTS');
 const debited=input+fees;
 // Ceiling conversion to USD cents from exact integer lamport maximum.
 const allInCents=(debited*fx+LAMPORTS-1n)/LAMPORTS;
 if(allInCents>1000n)return no('TEN_DOLLAR_ALL_IN_CAP');
 return {ok:true,executable:false,reason:'PRICE_AND_FEE_PREFLIGHT_ONLY',
  amountLamports:input.toString(),minOutputRaw:minOut.toString(),
  allInCents:allInCents.toString(),maxTotalWalletDebitLamports:debited.toString()};
}
