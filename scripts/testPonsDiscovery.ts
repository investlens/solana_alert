import {
  discoverFromPons,
} from '../src/chains/robinhood/discovery/launchpads/pons.js';

async function main() {
  console.log('');
  console.log(
    '🐸 AlphaOS pons Launch Discovery',
  );
  console.log('');

  const result =
    await discoverFromPons();

  console.log('');
  console.log(
    `Found ${result.tokens.length} recent pons launches`,
  );
  console.log('');

  console.table(
    result.tokens.map(
      (token) => ({
        token:
          token.tokenAddress,

        pool:
          token.pairAddress ??
          '',

        deployer:
          String(
            token.metadata?.deployer ??
            '',
          ),

        block:
          String(
            token.metadata?.blockNumber ??
            '',
          ),

        tx:
          String(
            token.metadata
              ?.transactionHash ??
            '',
          ),
      }),
    ),
  );
}

main().catch(
  (error) => {
    console.error(
      '❌ pons discovery failed:',
      error,
    );

    process.exit(1);
  },
);
