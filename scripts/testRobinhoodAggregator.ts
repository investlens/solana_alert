import {
  discoverRobinhoodEcosystem,
} from '../src/chains/robinhood/discovery/aggregator.js';

async function main() {
  console.log('');
  console.log(
    '🌐 AlphaOS Robinhood Ecosystem Discovery',
  );
  console.log('');

  const result =
    await discoverRobinhoodEcosystem(
      50,
    );

  console.log(
    'Sources:',
    result.sources,
  );

  console.log(
    'Raw:',
    result.totalRaw,
  );

  console.log(
    'Unique:',
    result.totalUnique,
  );

  console.log('');

  console.table(
    result.tokens.map(
      (token) => ({
        symbol:
          token.symbol ??
          'UNKNOWN',

        source:
          token.source,

        sourceType:
          token.sourceType,

        dex:
          token.dexId ??
          '',

        pair:
          token.pairAddress ??
          '',

        token:
          token.tokenAddress,
      }),
    ),
  );
}

main().catch((error) => {
  console.error(
    '❌ Robinhood aggregator test failed:',
    error,
  );

  process.exit(1);
});
