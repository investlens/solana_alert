import {
  refreshRobinhoodObserver,
} from '../src/chains/robinhood/robinhoodObserver.js';

async function main() {
  console.log('');
  console.log(
    '🟣 AlphaOS Robinhood Observer Test',
  );
  console.log('');

  await refreshRobinhoodObserver();

  console.log('');
  console.log(
    '✅ Robinhood observer test completed.',
  );
}

main().catch((error) => {
  console.error(
    '❌ Robinhood observer test failed:',
    error,
  );

  process.exit(1);
});
