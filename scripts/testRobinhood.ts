import {
  testRobinhoodRpc,
} from '../src/chains/robinhood/rpc.js';

async function main() {
  console.log(
    '🔌 Connecting AlphaOS to Robinhood Chain...',
  );

  const result =
    await testRobinhoodRpc();

  console.log(
    '✅ Robinhood Chain connected!',
  );

  console.log({
    chainId: result.chainId,
    blockNumber:
      result.blockNumber.toString(),
  });
}

main().catch((error) => {
  console.error(
    '❌ Robinhood RPC test failed:',
    error,
  );

  process.exit(1);
});
