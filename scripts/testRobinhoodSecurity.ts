import {
  runRobinhoodSecurityGate,
} from '../src/chains/robinhood/security/securityGate.js';

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
    '🛡 AlphaOS Robinhood Security Gate',
  );
  console.log('');

  const result =
    await runRobinhoodSecurityGate(
      token,
    );

  console.log({
    token:
      result.security.tokenAddress,

    symbol:
      result.security.symbol,

    name:
      result.security.name,

    decision:
      result.security.decision,

    score:
      result.security.score,

    severity:
      result.security.severity,

    allowed:
      result.allowed,

    review:
      result.requiresReview,

    blockers:
      result.security.blockers,

    warnings:
      result.security.warnings,
  });

  console.log('');

  console.table(
    result.security.checks.map(
      (check) => ({
        check:
          check.id,

        passed:
          check.passed,

        severity:
          check.severity,

        message:
          check.message,
      }),
    ),
  );
}

main().catch((error) => {
  console.error(
    '❌ Security test failed:',
    error,
  );

  process.exit(1);
});
