import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';
import { extractPumpAppRoutedEchoBuys } from '../src/echo/pumpAppRouteSignals.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';
import bs58 from 'bs58';

/**
 * Read-only one-shot public RPC diagnostic for user-supplied Slingoor signature.
 * Never uses a private key, signs, submits, or changes subscriptions.
 * A public RPC may rate limit this call; absence of data means UNAVAILABLE.
 */
const signature = '3tsw3jLK5fDZoeUZkHmLmRbPrUtxu3M4AymDV8638MgEgkjKq4KX4vfaDc8rquzcBXTqKDQS1RoiCofXojdnxKK1';
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
    const recognizedBuys = extractJupiterRoutedEchoBuys(tx,signature,tx.blockTime + 1);
    const direct = extractRpcEchoSignals(tx,signature,tx.blockTime + 1);
    const app = extractPumpAppRoutedEchoBuys(tx,signature,tx.blockTime + 1);
    const classifications = recognizedBuys.map(s=>({side:s.side,mint:s.mint,inputMint:s.quoteMint,tokenAmount:s.tokenAmount,quoteAmount:s.quoteAmount,caller:s.caller}));
    console.log('SAMPLE_TX_PROBE',JSON.stringify({outcome:'FOUND',success:tx.meta?.err===null,
      slot:tx.slot,blockTime:tx.blockTime,signers,programs,jupiterTags,walletDeltas,classifications,direct:direct.map(s=>({mint:s.mint,side:s.side})),app:app.map(s=>({mint:s.mint,side:s.side})),rejection:classifications.length||direct.length||app.length?null:classifyEchoRejection(tx,signature,tx.blockTime+1)}));
    if (tx.meta?.err !== null || signers.indexOf(slingoor) === -1 || ![...recognizedBuys,...direct,...app].some(s=>s.side==='BUY'&&s.caller==='WHALE · slingoor')) {
      console.error('SAMPLE_TX_VALIDATION_FAILED');
      process.exit(1);
    }
    process.exit(0);
  }catch{console.log('SAMPLE_TX_PROBE',JSON.stringify({rpcHost:new URL(endpoint).hostname,outcome:'NETWORK_UNAVAILABLE'}));}
}

console.error('SAMPLE_TX_UNAVAILABLE: no RPC endpoint returned the historical transaction');
process.exit(1);
