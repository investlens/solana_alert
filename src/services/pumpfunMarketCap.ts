export async function fetchPumpfunMarketCap(
  mintAddress: string
): Promise<number | null> {
  const token = process.env.BITQUERY_API_TOKEN ?? '';

  if (!token || !mintAddress) {
    return null;
  }

  const query = `
query PumpfunMarketCap($mint: String!) {
  Solana(dataset: realtime) {
    DEXTradeByTokens(
      limit: { count: 1 }
      orderBy: { descending: Block_Time }
      where: {
        Trade: {
          Currency: {
            MintAddress: { is: $mint }
          }
          Dex: {
            ProtocolName: { is: "pump" }
          }
        }
      }
    ) {
      Trade {
        Currency {
          MintAddress
          Symbol
        }
        Market {
          Marketcap
        }
      }
    }
  }
}
`;

  try {
    const res = await fetch('https://streaming.bitquery.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query,
        variables: { mint: mintAddress },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log('pumpfun market cap request failed:', {
        mintAddress,
        status: res.status,
        body: text.slice(0, 250),
      });
      return null;
    }

    const json = await res.json();

    if (json?.errors?.length) {
      console.log('pumpfun market cap graphql errors:', {
        mintAddress,
        errors: json.errors,
      });
      return null;
    }

    const row = json?.data?.Solana?.DEXTradeByTokens?.[0];
    const marketCap = Number(row?.Trade?.Market?.Marketcap ?? 0);

    if (!Number.isFinite(marketCap) || marketCap <= 0) {
      return null;
    }

    return marketCap;
  } catch (err) {
    console.log('pumpfun market cap fetch error:', {
      mintAddress,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}