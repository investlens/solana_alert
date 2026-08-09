import {
  discoverRobinhoodCandidates,
} from '../src/chains/robinhood/discovery.js';

async function main() {
  console.log('');
  console.log(
    '🔭 AlphaOS Robinhood Discovery V2',
  );
  console.log('');

  const candidates =
    await discoverRobinhoodCandidates(
      25,
    );

  console.log('');
  console.log(
    `Found ${candidates.length} ranked candidates`,
  );
  console.log('');

  if (!candidates.length) {
    console.log(
      'No Robinhood candidates discovered.',
    );

    return;
  }

  console.table(
    candidates.map(
      (candidate) => ({
        symbol:
          candidate.symbol,

        source:
          candidate.source,

        marketCap:
          Math.round(
            candidate.marketCapUsd,
          ),

        liquidity:
          Math.round(
            candidate.liquidityUsd,
          ),

        volume5m:
          Math.round(
            candidate.volume5mUsd,
          ),

        buys:
          candidate.buys5m,

        sells:
          candidate.sells5m,

        ratio:
          Number(
            candidate.buyRatio
              .toFixed(2),
          ),

        activity:
          Number(
            candidate.activityScore
              .toFixed(2),
          ),

        dex:
          candidate.dexId,

        token:
          candidate.tokenAddress,
      }),
    ),
  );
}

main().catch((error) => {
  console.error(
    '❌ Robinhood discovery failed:',
    error,
  );

  process.exit(1);
});
