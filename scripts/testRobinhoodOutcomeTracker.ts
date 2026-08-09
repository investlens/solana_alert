import 'dotenv/config';

import {
  refreshRobinhoodOutcomeTracker,
} from '../src/chains/robinhood/robinhoodOutcomeTracker.js';

async function main() {
  console.log('');
  console.log(
    '📈 AlphaOS Robinhood Outcome Tracker Test',
  );
  console.log('');

  await refreshRobinhoodOutcomeTracker();

  console.log('');
  console.log(
    '✅ Robinhood outcome tracker test completed.',
  );
}

main().catch((error) => {
  console.error(
    '❌ Robinhood outcome tracker test failed:',
    error,
  );

  process.exit(1);
});
