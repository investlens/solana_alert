import 'dotenv/config';

import {
  scanRobinhoodDevMovement,
} from '../src/chains/robinhood/security/devMovementScanner.js';

async function main() {
  const token =
    process.argv[2];

  if (!token) {
    console.error(
      'Usage: npx tsx scripts/testRobinhoodDevMovement.ts <tokenAddress>',
    );

    process.exit(1);
  }

  console.log('');
  console.log(
    '🚨 AlphaOS Robinhood Dev Movement Test',
  );
  console.log('');

  const result =
    await scanRobinhoodDevMovement(
      token,
    );

  console.log(result);
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
