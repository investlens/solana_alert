import {
  scanPonsSellability,
} from '../src/chains/robinhood/security/sellabilityScanner.js';

async function main() {
  const token =
    process.argv[2]?.trim();

  if (!token) {
    throw new Error(
      'Provide a PONS token address.',
    );
  }

  console.log('');
  console.log(
    '🔄 AlphaOS Robinhood Sellability',
  );
  console.log('');

  const result =
    await scanPonsSellability(
      token,
    );

  console.log({
    token:
      result.tokenAddress,

    ponsVerified:
      result.ponsVerified,

    pairedToken:
      result.pairedToken,

    poolFee:
      result.poolFee,

    status:
      result.status,

    sellable:
      result.sellable,

    impact:
      result.estimatedImpactPercent,

    blockers:
      result.blockers,

    warnings:
      result.warnings,
  });

  console.log('');

  if (result.smallQuote) {
    console.log(
      'SMALL SELL TEST',
    );

    console.log({
      tokensIn:
        result.smallQuote
          .amountInTokens,

      wethOut:
        result.smallQuote
          .amountOutWeth,

      ticksCrossed:
        result.smallQuote
          .initializedTicksCrossed,

      gasEstimate:
        result.smallQuote
          .gasEstimate
          .toString(),
    });

    console.log('');
  }

  if (result.largeQuote) {
    console.log(
      'LARGE SELL TEST',
    );

    console.log({
      tokensIn:
        result.largeQuote
          .amountInTokens,

      wethOut:
        result.largeQuote
          .amountOutWeth,

      ticksCrossed:
        result.largeQuote
          .initializedTicksCrossed,

      gasEstimate:
        result.largeQuote
          .gasEstimate
          .toString(),
    });

    console.log('');
  }
}

main().catch((error) => {
  console.error(
    '❌ Sellability test failed:',
    error,
  );

  process.exit(1);
});
