/**
 * Operator-only Jupiter v2 read-only BUY/SELL diagnostic.
 * Queries /order and simulateTransaction. NO signing, execution, or broadcast.
 * Do not print API credentials, raw transactions, or sensitive RPC URLs.
 */
import {readOnlyEchoJupiterV2Swap} from '../src/echo/readOnlyJupiterV2Swap.js';
const e=process.env;
const side=e.ECHO_PREVIEW_SIDE;
const wallet=e.ECHO_PREVIEW_WALLET?.trim();
const mint=e.ECHO_PREVIEW_MINT?.trim();
const amount=e.ECHO_PREVIEW_AMOUNT_RAW?.trim();
const rpcUrl=e.ECHO_PREVIEW_RPC_URL?.trim();
const apiKey=e.JUPITER_API_KEY?.trim();
if(side!=='BUY'&&side!=='SELL')throw Error('ECHO_PREVIEW_SIDE must be BUY or SELL');
if(!wallet||!mint||!amount||!rpcUrl||!apiKey)
 throw Error('Set ECHO_PREVIEW_WALLET, ECHO_PREVIEW_MINT, ECHO_PREVIEW_AMOUNT_RAW, ECHO_PREVIEW_RPC_URL and JUPITER_API_KEY');
const result=await readOnlyEchoJupiterV2Swap({
 side,publicWallet:wallet,mint,amountRaw:amount,rpcUrl,jupiterApiKey:apiKey,
 maxSlippageBps:300
});
const output=result.ok?{
 outcome:'SIMULATED',side,transactionSha256:result.unsignedTransactionSha256,
 quotedOutputRaw:result.quotedOutputRaw,simulationLogCount:result.logs.length,
 broadcast:false
}:{outcome:'NOT_VERIFIED',side,reason:result.reason,
  failureClass:result.failureClass??null,orderBuilt:result.orderBuilt??false,
  unsignedTransactionSha256:result.unsignedTransactionSha256??null,broadcast:false};
process.stdout.write(JSON.stringify(output)+'\n');
if(!result.ok)process.exitCode=1;
