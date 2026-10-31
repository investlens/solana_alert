import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';
import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';
import { extractPumpAppRoutedEchoBuys } from '../src/echo/pumpAppRouteSignals.js';
import bs58 from 'bs58';

/**
 * Read-only one-shot public RPC diagnostic for user-supplied Slingoor signature.
 * Never uses a private key, signs, submits, or changes subscriptions.
 * A public RPC may rate limit this call; absence of data means UNAVAILABLE.
 */
const signature = process.env.ECHO_REPLAY_SIGNATURE?.trim() || '5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw Error('INVALID_REPLAY_SIGNATURE');
const slingoor = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
for (const endpoint of ['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']) {
  try {
    const response = await fetch(endpoint, {
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[signature,{
        encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1
      }]}),signal:AbortSignal.timeout(8000)
    });
    if(!response.ok){console.log('SAMPLE_TX_PROBE',JSON.stringify({rpcHost:new URL(endpoint).hostname,status:response.status,outcome:'UNAVAILABLE'}));continue;}
    const data=await response.json();
    const tx=data.result;
    if(!tx){console.log('SAMPLE_TX_PROBE',JSON.stringify({rpcHost:new URL(endpoint).hostname,code:data.error?.code??null,outcome:'UNAVAILABLE'}));continue;}
    const accounts=tx.transaction?.message?.accountKeys??[];
    const signers=accounts.filter((a:any)=>a.signer).map((a:any)=>a.pubkey);
    const instructions = tx.transaction?.message?.instructions ?? [];
    const programs=[...new Set(instructions.map((ix:any)=>ix.programId))];
    const jupiterTags = instructions.filter((ix:any)=>ix.programId==='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
      .map((ix:any)=>({length: typeof ix.data==='string' ? bs58.decode(ix.data).length : null,
        discriminator: typeof ix.data==='string' ? Buffer.from(bs58.decode(ix.data).subarray(0,8)).toString('hex') : null }));
    const deltas=new Map<string,{decimals:number,delta:bigint}>();
    for(const [direction,rows] of [[-1n,tx.meta?.preTokenBalances??[]],[1n,tx.meta?.postTokenBalances??[]]] as const){
      for(const row of rows){if(row.owner!==slingoor)continue;const cur=deltas.get(row.mint);
        deltas.set(row.mint,{decimals:row.uiTokenAmount.decimals,delta:(cur?.delta??0n)+direction*BigInt(row.uiTokenAmount.amount)});
      }
    }
    const walletDeltas=[...deltas].map(([mint,v])=>({mint,change:Number(v.delta)/10**v.decimals}));
    const direct = extractRpcEchoSignals(tx,signature,tx.blockTime + 1);
    const jupiter = extractJupiterRoutedEchoBuys(tx,signature,tx.blockTime + 1);
    const pumpApp = extractPumpAppRoutedEchoBuys(tx,signature,tx.blockTime + 1);
    const recognizedBuys = direct.length ? direct : jupiter.length ? jupiter : pumpApp;
    const rejection = recognizedBuys.length ? null : classifyEchoRejection(tx,signature,tx.blockTime+1);
    const classifications = recognizedBuys.map(s=>({side:s.side,mint:s.mint,inputMint:s.quoteMint,tokenAmount:s.tokenAmount,quoteAmount:s.quoteAmount,caller:s.caller}));
    console.log('SAMPLE_TX_PROBE',JSON.stringify({outcome:'FOUND',success:tx.meta?.err===null,
      slot:tx.slot,blockTime:tx.blockTime,signers,programs,jupiterTags,walletDeltas,classifications,
      classifierCounts:{direct:direct.length,jupiter:jupiter.length,pumpApp:pumpApp.length},rejection}));
    if (tx.meta?.err !== null || signers.indexOf(slingoor) === -1 || recognizedBuys.length !== 1 || recognizedBuys[0].side !== 'BUY' || recognizedBuys[0].caller !== 'WHALE · slingoor') {
      console.error('SAMPLE_TX_VALIDATION_FAILED');
      process.exit(1);
    }
    process.exit(0);
  }catch{console.log('SAMPLE_TX_PROBE',JSON.stringify({rpcHost:new URL(endpoint).hostname,outcome:'NETWORK_UNAVAILABLE'}));}
}

console.error('SAMPLE_TX_UNAVAILABLE: no RPC endpoint returned the historical transaction');
if(process.env.ECHO_REPLAY_UNAVAILABLE_NONBLOCKING==='true'){
  // ONLY transient provider unavailability can be non-blocking. Any fetched
  // transaction with an invalid classification exited with code 1 above.
  console.warn('SAMPLE_TX_UNAVAILABLE_NONBLOCKING: no on-chain replay evidence from this CI run');
  process.exit(0);
}
process.exit(1);
