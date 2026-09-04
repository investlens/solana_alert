import 'dotenv/config';
import { getAllPonsDeveloperIntelligence } from '../src/chains/robinhood/ponsDeveloperIntelligence.js';

const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const developers = await getAllPonsDeveloperIntelligence();
console.table(developers.map(row => ({
  Developer: row.developerAddress, Pons: row.totalPonsLaunches, Outcomes: row.launchesWithUsableOutcomes,
  '100K': row.winners100k, '500K': row.winners500k, '1M': row.winners1m,
  '5M': row.winners5m, '10M': row.winners10m, Best: row.bestKnownPeakMarketCap,
  HitRate100K: percent(row.hitRate100k), HitRate1M: percent(row.hitRate1m),
  Recent5_100K: row.recent5Hits100k, Recent5_1M: row.recent5Hits1m, Crash: percent(row.severeCrashRate),
  Confidence: row.sampleConfidence, Tier: row.tier, Blocked: row.isBlocked,
})));
console.log(`[PonsOutcomeReport] developers=${developers.length}; Pons is total authoritative launches, Outcomes is usable exact-token outcome observations.`);
