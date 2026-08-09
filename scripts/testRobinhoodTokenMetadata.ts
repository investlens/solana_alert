import {
  getRobinhoodTokenMetadata,
} from '../src/chains/robinhood/tokenMetadata.js';

async function main() {
  const token =
    process.argv[2]?.trim();

  if (!token) {
    throw new Error(
      'Provide a token address.',
    );
  }

  console.log('');
  console.log(
    '🧬 AlphaOS Robinhood Token Metadata',
  );
  console.log('');

  const metadata =
    await getRobinhoodTokenMetadata(
      token,
    );

  console.log(metadata);
}

main().catch((error) => {
  console.error(
    '❌ Metadata test failed:',
    error,
  );

  process.exit(1);
});
