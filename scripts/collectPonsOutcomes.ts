import 'dotenv/config';
import { collectPonsTokenOutcomes, createProductionPonsOutcomeSource, formatPonsOutcomeSummary } from '../src/chains/robinhood/ponsTokenOutcomeCollector.js';

const values = new Map(process.argv.slice(2).map(arg => { const [key, value = 'true'] = arg.replace(/^--/, '').split('=', 2); return [key, value]; }));
const write = values.has('write');
const filters = { factory: values.get('factory'), deployer: values.get('deployer'), token: values.get('token'),
  limit: values.has('limit') ? Number(values.get('limit')) : 100 };
console.log(`[PonsOutcomes] starting deployer=${filters.deployer ?? 'all'} limit=${filters.limit} dryRun=${!write}`);
try {
  const result = await collectPonsTokenOutcomes(await createProductionPonsOutcomeSource(), {
    filters, concurrency: values.has('concurrency') ? Number(values.get('concurrency')) : 5, write,
    onProgress: progress => console.log(`[PonsOutcomes] progress=${progress.processed}/${progress.total} currentMcFound=${progress.currentMcFound} historicalFound=${progress.historicalFound} failures=${progress.currentLookupFailures}`),
  });
  if (result.scanned === 0) console.log('[PonsOutcomes] no authoritative Pons launches matched the requested filters');
  for (const line of formatPonsOutcomeSummary(result, !result.wrote)) console.log(line);
} catch (error) {
  console.error(`[PonsOutcomes] failed reason=${error instanceof Error ? error.message : String(error)}`);
  for (const line of formatPonsOutcomeSummary({ outcomes: [], scanned: 0, currentMcFound: 0,
    historicalObservationsFound: 0, verifiedPeakFound: 0, crossed100k: 0, crossed500k: 0, crossed1m: 0, crossed5m: 0, crossed10m: 0,
    unknown: 0, currentLookupFailures: 0, wrote: false, writes: 0 }, !write)) console.log(line);
  console.log('[PonsOutcomes] incomplete=true');
  process.exitCode = 1;
}
