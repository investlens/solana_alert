import {
  scanRobinhoodPoolSecurity,
} from '../src/chains/robinhood/security/poolSecurityScanner.js';

async function main() {
  const token =
    process.argv[2];

  const pair =
    process.argv[3];

  if (!token) {
    throw new Error(
      'Provide token address and optionally pair address.',
    );
  }

  console.log('');
  console.log(
    '💧 AlphaOS Robinhood Pool Security',
  );
  console.log('');

  const result =
    await scanRobinhoodPoolSecurity({
      tokenAddress:
        token,

      pairAddress:
        pair,
    });

  console.log(result);
}

main().catch((error) => {
  console.error(
    '❌ Pool security test failed:',
    error,
  );

  process.exit(1);
});
