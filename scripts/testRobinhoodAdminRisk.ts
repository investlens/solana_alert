import {
  scanRobinhoodAdminRisk,
} from '../src/chains/robinhood/security/adminRiskScanner.js';

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
    '🔐 AlphaOS Robinhood Admin Risk',
  );
  console.log('');

  const result =
    await scanRobinhoodAdminRisk(
      token,
    );

  console.log({
    token:
      result.tokenAddress,

    owner:
      result.ownerAddress,

    ownershipReadable:
      result.ownershipReadable,

    ownershipRenounced:
      result.ownershipRenounced,

    confirmedRiskCount:
      result.confirmedRiskCount,

    indicatorCount:
      result.indicatorCount,

    scorePenalty:
      result.scorePenalty,
  });

  console.log('');

  console.table(
    result.signals
      .filter(
        (signal) =>
          signal.detected,
      )
      .map(
        (signal) => ({
          signal:
            signal.id,

          confidence:
            signal.confidence,

          severity:
            signal.severity,

          label:
            signal.label,
        }),
      ),
  );
}

main().catch((error) => {
  console.error(
    '❌ Admin-risk test failed:',
    error,
  );

  process.exit(1);
});
