import 'dotenv/config';

const token = process.argv[2];

if (!token) {
  console.error('Usage: npx tsx scripts/test-bitquery-marketcap.ts <mint>');
  process.exit(1);
}

const apiToken = process.env.BITQUERY_API_TOKEN;

if (!apiToken) {
  console.error('Missing BITQUERY_API_TOKEN');
  process.exit(1);
}

const query = `
query TokenMarketCap($mint: String!) {
  Solana {
    TokenSupplyUpdates(
      limit: { count: 1 }
      orderBy: { descending: Block_Time }
      where: {
        TokenSupplyUpdate: {
          Currency: {
            MintAddress: { is: $mint }
          }
        }
      }
    ) {
      Block {
        Time
      }
      TokenSupplyUpdate {
        Currency {
          MintAddress
          Symbol
          Name
        }
        PostBalanceInUSD
        PostBalance
      }
    }
  }
}
`;

async function main() {
  const res = await fetch('https://streaming.bitquery.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify({
      query,
      variables: { mint: token },
    }),
  });

  const json = await res.json();

  console.log('HTTP STATUS:', res.status);
  console.dir(json, { depth: null });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});