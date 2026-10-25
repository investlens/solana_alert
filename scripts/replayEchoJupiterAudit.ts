/** Replays historical Jupiter candidates directly from Solana RPC without sending alerts.
 * Usage: ECHO_RPC_URL=... node --import tsx scripts/replayEchoJupiterAudit.ts output.json
 */
import {writeFile} from 'node:fs/promises';
import {echoJupiterAuditFixtures} from '../tests/fixtures/echoJupiterMissed.js';
import {identifyJupiterCandidates} from '../src/echo/jupiterCandidates.js';
import {extractRpcEchoSignals} from '../src/echo/rpcSignals.js';
import type {ParsedTransactionWithMeta} from '@solana/web3.js';
const rpcUrl=process.env.ECHO_RPC_URL;
const output=process.argv[2];
if(!rpcUrl||!output)throw Error('ECHO_RPC_URL and output path required');
const results:unknown[]=[];
let checked=0,matched=0;
for(const fixture of echoJupiterAuditFixtures){
  const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++checked,method:'getTransaction',
    params:[fixture.signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:1}]}),
    signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('RPC HTTP '+response.status);
  const body=await response.json();
  if(body.error)throw Error('RPC response '+String(body.error.code));
  const tx=body.result as ParsedTransactionWithMeta|null;
  const candidates=identifyJupiterCandidates(tx,fixture.signature);
  const match=candidates.find(x=>x.caller===fixture.caller&&x.mint===fixture.mint&&x.side===fixture.side);
  const previouslyRecognized=tx?extractRpcEchoSignals(tx,fixture.signature,(tx.blockTime??0)+1).length:0;
  const status=tx==null?'TX_NOT_AVAILABLE':match?'CANDIDATE_MATCH':'CANDIDATE_MISMATCH';
  if(match)matched++;
  results.push({caller:fixture.caller,signature:fixture.signature,expected:fixture.side,
    observed:candidates.map(x=>({side:x.side,mint:x.mint,verification:x.verification})),
    oldParserDetected:previouslyRecognized,status});
}
const report={checked,matched,results,note:'Read-only observational candidates; NOT verified fills, profit, or authorized alerts.'};
await writeFile(output,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({checked,matched,notMatched:checked-matched}));
if(matched!==checked)process.exitCode=1;
