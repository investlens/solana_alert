import 'dotenv/config';
import { supabase } from '../src/services/supabase.js';
import { aggregatePonsDevelopers } from '../src/chains/robinhood/ponsDeveloperReport.js';

const { data, error } = await supabase.from('pons_launches').select('deployer_address,protocol_version,block_timestamp').eq('chain', 'robinhood');
if (error) throw new Error(error.message);
const report = aggregatePonsDevelopers(data ?? []);
console.table(report.map(row => ({ developer: row.developer, launches: row.totalLaunches, firstLaunch: row.firstLaunch,
  latestLaunch: row.latestLaunch, versions: JSON.stringify(row.countsByVersion) })));
console.log(`[PonsDeveloperReport] developers=${report.length}; launch count is activity, not quality or performance.`);
