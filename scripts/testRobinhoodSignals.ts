import 'dotenv/config';

import {
  scanRobinhoodDevHolding,
} from '../src/chains/robinhood/security/devHoldingScanner.js';

import {
  scanRobinhoodDexPaid,
} from '../src/chains/robinhood/security/dexPaidScanner.js';

async function main() {
  const token =
    process.argv[2]?.trim();

  if (!token) {
    throw new Error(
      'Provide a Robinhood token address.',
    );
  }

  console.log('');
  console.log(
    '🧠 AlphaOS Robinhood Signals',
  );
  console.log('');

  const [
    dev,
    dex,
  ] =
    await Promise.all([
      scanRobinhoodDevHolding(
        token,
      ),

      scanRobinhoodDexPaid(
        token,
      ),
    ]);

  console.log(
    'DEV HOLDING',
  );

  console.log({
    deployer:
      dev.deployerAddress,

    holdingPercent:
      dev.holdingPercent,

    tokens:
      dev.balanceTokens,

    status:
      dev.status,

    warnings:
      dev.warnings,
  });

  console.log('');

  console.log(
    'DEX PAID',
  );

  console.log({
    dexPaid:
      dex.dexPaid,

    status:
      dex.status,

    orderTypes:
      dex.orderTypes,

    orderStatuses:
      dex.orderStatuses,

    paymentTimestamp:
      dex.latestPaymentTimestamp,

    warnings:
      dex.warnings,
  });
}

main().catch(
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
