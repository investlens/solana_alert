// @ts-nocheck — prototype SDK loaded only in bounded CI probe; production integration requires pinned dependency and full types.
/** Strict first-party PumpSwap SDK unsigned probe. NEVER signs or broadcasts.
 * This is diagnostic only; a builder returning instructions is not authorization.
 * SDK v4.3.1 is deliberately installed only in the one-shot CI job.
 */
import {Connection,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import BN from 'bn.js';

const PUMP_AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const WSOL='So11111111111111111111111111111111111111112';
const WALLET='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const MINT='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const POOL='JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8';
const RPC='https://api.mainnet-beta.solana.com';
const REQUESTED_LAMPORTS=25_000_000;
let rpcCalls=0;
const permitted=new Set(['getAccountInfo','getMultipleAccounts','getLatestBlockhash','getMinimumBalanceForRentExemption','getRecentPrioritizationFees','simulateTransaction']);
const fetcher:typeof fetch=(async(input:any,init?:any)=>{
 const url=String(input);
 if(url!==RPC&&url!==RPC+'/')throw Error('RPC_DESTINATION_NOT_APPROVED');
 const body=JSON.parse(String(init?.body??'{}'));
 const reqs=Array.isArray(body)?body:[body];
 if(reqs.length>10||reqs.some(r=>!permitted.has(r.method)))throw Error('UNREVIEWED_RPC_METHOD');
 rpcCalls+=reqs.length;
 if(rpcCalls>15)throw Error('RPC_CALL_BUDGET_EXCEEDED');
 return fetch(input,init);
}) as typeof fetch;
const report:any={mode:'FIRST_PARTY_PUMPSWAP_UNSIGNED',
 provider:'@pump-fun/pump-sdk/swap@4.3.1',wallet:WALLET.slice(0,6)+'...'+WALLET.slice(-4),
 requestedBuyLamports:REQUESTED_LAMPORTS,expectedMint:MINT,
 expectedPool:POOL,transactionConstructed:false,simulationPassed:false,
 signatureCreated:false,broadcast:false,signingApproved:false};
try{
 const {OnlinePumpAmmSdk,PUMP_AMM_SDK}=await import('@pump-fun/pump-sdk/swap');
 const connection=new Connection(RPC,{commitment:'confirmed',fetch:fetcher});
 const poolKey=new PublicKey(POOL),user=new PublicKey(WALLET),mint=new PublicKey(MINT);
 const online=new OnlinePumpAmmSdk(connection);
 const state=await online.swapSolanaState(poolKey,user);
 // Inspect live decoded pool accounts before authorizing any instruction.
 const pool=state?.pool;
 if(!pool||!pool.baseMint?.equals(mint)||!pool.quoteMint?.equals(new PublicKey(WSOL)))
  throw Error('POOL_MINT_PAIR_NOT_VERIFIED');
 report.poolMintPairVerified=true;
 const instructions=await PUMP_AMM_SDK.buyQuoteInput(state,new BN(REQUESTED_LAMPORTS),3);
 if(!Array.isArray(instructions)||instructions.length===0||instructions.length>10)
  throw Error('INVALID_SDK_INSTRUCTIONS');
 const ids=instructions.map(ix=>ix.programId.toBase58());
 const allowed=new Set([PUMP_AMM,'ComputeBudget111111111111111111111111111111',
  '11111111111111111111111111111111','TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFCE7uFyV9QnF4jrb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL']);
 report.programs=ids;
 if(ids.some(id=>!allowed.has(id))||ids.filter(id=>id===PUMP_AMM).length!==1)
  throw Error('UNREVIEWED_PROGRAM_OR_SWAP_COUNT');
 const latest=await connection.getLatestBlockhash('confirmed');
 const msg=new TransactionMessage({payerKey:user,recentBlockhash:latest.blockhash,instructions})
  .compileToV0Message();
 if(msg.addressTableLookups.length!==0)throw Error('UNRESOLVED_LOOKUP_TABLES');
 const tx=new VersionedTransaction(msg);
 if(tx.signatures.length!==1||!tx.signatures[0].every(n=>n===0))
  throw Error('UNEXPECTED_SIGNATURE');
 report.transactionConstructed=true;
 report.instructionCount=instructions.length;
 report.unsignedBytes=tx.serialize().length;
 // Intentional stop before simulation if wallet is unfunded. A hypothetical
 // success under fabricated balance is not proof the current wallet can pay.
 const balance=await connection.getBalance(user,'confirmed');
 report.walletIsUnfunded=balance<REQUESTED_LAMPORTS;
 if(balance<REQUESTED_LAMPORTS+5_000_000)
  throw Error('INSUFFICIENT_BALANCE_FOR_VALID_SIMULATION');
 // Even with funds, this script reports only simulation diagnostics, never
 // a trusted spending approval: quote may include extra SOL/ATA/fee costs.
 const simulation=await connection.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:true});
 report.simulationPassed=simulation.value.err===null;
 report.unitsConsumed=simulation.value.unitsConsumed??null;
 if(!report.simulationPassed)throw Error('SIMULATION_REJECTED');
 report.result='UNSIGNED_SIMULATION_PASSED_NOT_AUTHORIZED';
}catch(e){
 report.result='NOT_VERIFIED';
 const reason=e instanceof Error?e.message:'UNKNOWN';
 // Sanitized, finite failure categories; no provider text, URLs or raw tx.
 const known=['POOL_MINT_PAIR_NOT_VERIFIED','INVALID_SDK_INSTRUCTIONS',
 'UNREVIEWED_PROGRAM_OR_SWAP_COUNT','UNRESOLVED_LOOKUP_TABLES',
 'UNEXPECTED_SIGNATURE','INSUFFICIENT_BALANCE_FOR_VALID_SIMULATION',
 'SIMULATION_REJECTED','RPC_DESTINATION_NOT_APPROVED','UNREVIEWED_RPC_METHOD',
 'RPC_CALL_BUDGET_EXCEEDED'];
 report.reason=known.includes(reason)?reason:'SDK_OR_RPC_UNAVAILABLE';
}
report.rpcRequests=rpcCalls;
process.stdout.write('ECHO_OFFICIAL_PUMP_SDK '+JSON.stringify(report)+'\n');
if(!report.simulationPassed)process.exitCode=1;
