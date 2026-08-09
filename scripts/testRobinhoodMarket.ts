import {
  getRobinhoodMarketSnapshot,
} from '../src/chains/robinhood/market.js';

async function main() {
  const tokenAddress =
    process.argv[2]?.trim();

  if (!tokenAddress) {
    console.log('');
    console.log(
      'Usage: npx tsx scripts/testRobinhoodMarket.ts <TOKEN_ADDRESS>',
    );
    console.log('');

    process.exit(1);
  }

  console.log('');
  console.log(
    '🔎 AlphaOS Robinhood Market Test',
  );
  console.log(
    'Token:',
    tokenAddress,
  );
  console.log('');

  const snapshot =
    await getRobinhoodMarketSnapshot(
      tokenAddress,
    );

  if (!snapshot) {
    console.log(
      '❌ No Robinhood market snapshot found.',
    );

    process.exit(1);
  }

  const buyRatio =
    snapshot.sells5m > 0
      ? snapshot.buys5m /
        snapshot.sells5m
      : snapshot.buys5m;

  console.log(
    '✅ Robinhood market data found!',
  );

  console.log('');
  console.log('──────── TOKEN ────────');

  console.log({
    chain: snapshot.chain,
    symbol: snapshot.symbol,
    name: snapshot.name,
    tokenAddress:
      snapshot.tokenAddress,
  });

  console.log('');
  console.log('──────── MARKET ────────');

  console.log({
    priceUsd:
      snapshot.priceUsd,

    marketCapUsd:
      snapshot.marketCapUsd,

    liquidityUsd:
      snapshot.liquidityUsd,

    volume5mUsd:
      snapshot.volume5mUsd,

    buys5m:
      snapshot.buys5m,

    sells5m:
      snapshot.sells5m,

    buyRatio:
      Number(
        buyRatio.toFixed(2),
      ),
  });

  console.log('');
  console.log('──────── DEX ────────');

  console.log({
    dexId:
      snapshot.dexId,

    pairAddress:
      snapshot.pairAddress,

    chartUrl:
      snapshot.chartUrl,
  });

  console.log('');
  console.log(
    '🚀 Snapshot ready for AlphaOS.',
  );
}

main().catch((error) => {
  console.error('');
  console.error(
    '❌ Robinhood market test failed:',
    error,
  );

  process.exit(1);
});
