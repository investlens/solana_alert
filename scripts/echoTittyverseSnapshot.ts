/**
 * Offline, bounded Tittyverse research snapshot CLI.
 *
 * Usage: npx tsx scripts/echoTittyverseSnapshot.ts path/to/snapshot.json
 * Input must be independently captured and timestamped. This never scrapes
 * the live website, calls RPC, sends Telegram or executes a trade.
 * Sample schema:
 * {"tokens":[{"mint":"...","symbol":"ABC","observedAtMs":1793510000000,
 *   "marketCapUsd":3000,"liquidityUsd":2500,"inTittyverse":true}],
 *  "pairs":[{"pairAddress":"...","mintA":"...","mintB":"...",
 *   "verifiedAtMs":1793510000000,"source":"ONCHAIN","verified":true}],
 *  "buys":[{"wallet":"...","mint":"...","signature":"...",
 *   "blockTimeMs":1793510010000,"signerVerified":true,
 *   "side":"BUY","transferOnly":false}]}
 */
import {readFileSync,statSync} from 'node:fs';
import {evaluateTittyverseSnapshot} from '../src/echo/tittyverseResearch.js';

const input=process.argv[2];
if(!input||process.argv.length!==3)throw Error('RESEARCH_JSON_INPUT_FILE_REQUIRED');
if(statSync(input).size>512_000)throw Error('RESEARCH_SNAPSHOT_FILE_TOO_LARGE');
const value:unknown=JSON.parse(readFileSync(input,'utf8'));
if(!value||typeof value!=='object'||Array.isArray(value))
 throw Error('INVALID_RESEARCH_SNAPSHOT');
const record=value as Record<string,unknown>;
if(!Array.isArray(record.tokens)||!Array.isArray(record.pairs)||!Array.isArray(record.buys))
 throw Error('INVALID_RESEARCH_SNAPSHOT');
const findings=evaluateTittyverseSnapshot({
 tokens:record.tokens as Parameters<typeof evaluateTittyverseSnapshot>[0]['tokens'],
 pairs:record.pairs as Parameters<typeof evaluateTittyverseSnapshot>[0]['pairs'],
 buys:record.buys as Parameters<typeof evaluateTittyverseSnapshot>[0]['buys']
});
console.log(JSON.stringify({
 source:'INDEPENDENT_OFFLINE_SNAPSHOT',liveExecution:false,
 counts:{listed:findings.length,verifiedPairs:record.pairs.length,verifiedSignerBuys:findings.filter(f=>f.slingoorFirstBuyAtMs!==null).length,
  candidate1kTo5k:findings.filter(f=>f.candidate1kTo5k).length,
  earlyLeads:findings.filter(f=>f.discoveredBeforeBuy===true).length},
 findings
},null,2));
