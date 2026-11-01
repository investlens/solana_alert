/** One bounded live DEX read for a curated set of Tittyverse links,
 * followed by offline, independently verified Slingoor BUY correlation.
 * This does not poll Tittyverse's 401-protected API, sign, trade, or alert.
 * Usage: npx tsx scripts/echoTittyverseCuratedSnapshot.ts path/to/curated.json
 */
import {readFileSync,statSync} from 'node:fs';
import {collectCuratedTittyverseResearch} from '../src/echo/tittyverseCuratedCollector.js';
import type {VerifiedCallerBuy} from '../src/echo/tittyverseResearch.js';
import type {UserTittyverseLead} from '../src/echo/tittyverseCuratedCollector.js';
if(process.argv.length!==3)throw Error('CURATED_RESEARCH_INPUT_FILE_REQUIRED');
const file=process.argv[2];
if(statSync(file).size>32_768)throw Error('CURATED_RESEARCH_INPUT_TOO_LARGE');
const data:unknown=JSON.parse(readFileSync(file,'utf8'));
if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_CURATED_INPUT');
const record=data as Record<string,unknown>;
if(!Array.isArray(record.leads)||!Array.isArray(record.verifiedBuys))
 throw Error('INVALID_CURATED_INPUT');
const snapshot=await collectCuratedTittyverseResearch({
 leads:record.leads as UserTittyverseLead[],
 verifiedBuys:record.verifiedBuys as VerifiedCallerBuy[]
});
console.log('ECHO_TITTYVERSE_CURATED_RESEARCH',JSON.stringify(snapshot));
