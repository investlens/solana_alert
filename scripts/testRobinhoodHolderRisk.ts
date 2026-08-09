import {
  scanRobinhoodHolderRisk,
} from '../src/chains/robinhood/security/holderRiskScanner.js';

async function main() {
  const token =
    process.argv[2]
      ?.trim();

  const pool =
    process.argv[3]
      ?.trim();

  if (!token) {
    throw new Error(
      'Provide token address and optionally pool address.',
    );
  }

  console.log('');
  console.log(
    '👥 AlphaOS Robinhood Holder Risk',
  );
  console.log('');

  const result =
    await scanRobinhoodHolderRisk(
      token,
      {
        poolAddress:
          pool,
      },
    );

  console.log(result);
}

main().catch(
  (error) => {
    console.error(
      error,
    );

    process.exit(1);
  },
);
