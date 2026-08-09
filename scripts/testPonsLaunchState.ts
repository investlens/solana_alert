import {
  getPonsLaunchState,
} from '../src/chains/robinhood/ponsLaunchState.js';

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
    '🐸 AlphaOS PONS Launch Verification',
  );
  console.log('');

  const state =
    await getPonsLaunchState(
      token,
    );

  console.log({
    token:
      state.token,

    deployer:
      state.deployer,

    pairedToken:
      state.pairedToken,

    positionManager:
      state.positionManager,

    poolFee:
      state.poolFee,

    isToken0:
      state.isToken0,

    exists:
      state.exists,

    supply:
      state.supply.toString(),

    restrictionsEndBlock:
      state.restrictionsEndBlock
        .toString(),

    initialBuyAmount:
      state.initialBuyAmount
        .toString(),
  });
}

main().catch(
  (error) => {
    console.error(
      '❌ PONS launch verification failed:',
      error,
    );

    process.exit(1);
  },
);
