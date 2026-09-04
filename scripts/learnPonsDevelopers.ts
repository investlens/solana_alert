import 'dotenv/config';
import { learnPonsDevelopers } from '../src/chains/robinhood/ponsDeveloperLearning.js';

const rawLimit = process.argv.slice(2).find(argument => argument.startsWith('--limit='))?.slice('--limit='.length);
const limit = rawLimit == null ? 100 : Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error('--limit must be an integer between 1 and 1000');

console.log(`[PonsLearning] starting limit=${limit}`);
const result = await learnPonsDevelopers({
  limit,
  onSelected: selected => console.log(`[PonsLearning] selected=${selected}`),
  onOutcomeProgress: progress => console.log(`[PonsLearning] outcomes=${progress.processed}/${progress.total}`),
});
if (result.selected === 0) console.log('[PonsLearning] no launches currently need learning');
console.log(`[PonsLearning] outcomes written=${result.outcomesWritten}`);
console.log(`[PonsLearning] deployers=${result.distinctDeployers}`);
console.log(`[PonsLearning] registry refreshed=${result.registryRefreshed}`);
console.log(`[PonsLearning] created=${result.registryCreated} updated=${result.registryUpdated}`);
console.log(`[PonsLearning] tiers GEM=${result.tiers.GEM} KING=${result.tiers.KING} LEGEND=${result.tiers.LEGEND} PROVEN=${result.tiers.PROVEN} PROMISING=${result.tiers.PROMISING} UNKNOWN=${result.tiers.UNKNOWN} HIGH_RISK=${result.tiers.HIGH_RISK} SPAM_LAUNCHER=${result.tiers.SPAM_LAUNCHER} SCAMMER=${result.tiers.SCAMMER}`);
console.log(`[PonsLearning] blocked=${result.blocked}`);
