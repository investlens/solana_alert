/**
 * Historical shadow comparison of BOOST strategies A and C from a READ-ONLY
 * copy of Echo's persisted research journal.
 * Usage: npx tsx scripts/echoCompareBoostPaperStrategies.ts /path/to/research-v1.json
 *
 * Never loads production secrets, writes to the journal, sends Telegram
 * messages or submits transactions. Do not compare post-exit milestones as
 * profits. All results are mark-only estimates; no route depth is validated.
 */
import {readFile} from 'node:fs/promises';
import {replayBoostStrategyC} from '../src/echo/boostStrategyCPaper.js';
type Trial={
 caller:string; mint:string;deliveryAt:number;entry:number|null;entryAt:number|null;
 exitAt:number|null;exitPrice:number|null;status:string;
 pool:string|null;points:Array<{at:number;usd:number;liquidityUsd:number|null;pool:string}>;
};
type Journal={version:number;trials:Trial[]};
const file=process.argv[2];
if(!file)throw Error('READ_ONLY_RESEARCH_JOURNAL_PATH_REQUIRED');
const document=JSON.parse(await readFile(file,'utf8')) as Journal;
if(document.version!==1||!Array.isArray(document.trials))throw Error('INVALID_JOURNAL_VERSION');
const cutoff=process.argv[3]?Date.parse(process.argv[3])/1000:null;
if(process.argv[3]&&(cutoff===null||!Number.isFinite(cutoff)))throw Error('INVALID_CUTOFF');
let opportunities=0,scorable=0,aClosed=0,cClosed=0,
 aNet=0,cNet=0,cOpen=0,cRejected=0;
const comparison=[];
for(const trial of document.trials){
 if(trial.caller!=='SOLANA_BOOST'||!Array.isArray(trial.points)||
  (cutoff!==null&&trial.deliveryAt<cutoff))continue;
 opportunities++;
 if(!(trial.entry&&trial.entry>0&&trial.entryAt!==null))continue;
 const observed=trial.points.filter(x=>x.at>=trial.entryAt!&&
  Number.isFinite(x.usd)&&x.usd>0)
  .map(p=>({at:p.at,priceUsd:p.usd,liquidityUsd:p.liquidityUsd,pool:p.pool}))
  .sort((a,b)=>a.at-b.at);
 const unique=observed.filter((p,i)=>i===0||p.at>observed[i-1].at);
 if(unique.length<2)continue;
 scorable++;
 const c=replayBoostStrategyC(unique);
 if(c.status==='INVALID_OBSERVATIONS'){cRejected++;continue;}
 const a=trial.exitAt!==null&&trial.exitPrice!==null&&trial.exitPrice>0?
  10*.99*.99*trial.exitPrice/trial.entry-10:null;
 if(a!==null){aClosed++;aNet+=a;}
 const cNetExit=c.status==='CLOSED'?c.estimatedRealizedPnlUsd:null;
 if(cNetExit!==null){cClosed++;cNet+=cNetExit;} else cOpen++;
 comparison.push({
  mint:trial.mint,existingFullExitPaperPnlUsd:a===null?null:+a.toFixed(4),
  strategyCClosedPaperPnlUsd:cNetExit===null?null:+cNetExit.toFixed(4),
  strategyCRemainingFraction:c.remainingFraction,
  strategyCFirstPartialAt:c.exits.find(x=>x.kind==='PARTIAL_75')?.at??null,
  strategyCExitKinds:c.exits.map(x=>x.kind),
  observedSamples:unique.length,executableVerified:false
 });
}
process.stdout.write(JSON.stringify({
 schema:'echo.boost.strategy-c.historical-mark-comparison.v1',paperUsd:10,
 historicalEntrySet:'SOLANA_BOOST',opportunities,scorable,
 baselineClosed:aClosed,baselineClosedNetUsd:+aNet.toFixed(2),
 strategyCClosed:cClosed,strategyCClosedNetUsd:+cNet.toFixed(2),
 strategyCOpenOrPartiallyOpen:cOpen,invalidCTrials:cRejected,
 note:'Not a paired net-PnL score unless both strategies closed on the same trades; samples are mark prices, not firm executable sell quotes. Future liquidity, gaps and actual fees remain unknown.',
 comparison
 })+'\n');
