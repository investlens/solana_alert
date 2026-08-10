import 'dotenv/config';

import {
  startRobinhoodBoostObserver,
} from '../src/chains/robinhood/robinhoodBoostObserver.js';

console.log('');
console.log('⚡ AlphaOS Robinhood Boost Observer Test');
console.log('');

startRobinhoodBoostObserver();

setTimeout(() => {
  console.log('');
  console.log('✅ Boost observer test completed.');
  process.exit(0);
}, 65_000);
