const marketCapCache = new Map<string, { value: number | null; expiresAt: number }>();

let bitqueryBackoffUntil = 0;

function now() {
  return Date.now();
}

function getCachedMarketCap(mintAddress: string) {
  const cached = marketCapCache.get(mintAddress);
  if (!cached) return undefined;

  if (cached.expiresAt <= now()) {
    marketCapCache.delete(mintAddress);
    return undefined;
  }

  return cached.value;
}

function setCachedMarketCap(mintAddress: string, value: number | null) {
  marketCapCache.set(mintAddress, {
    value,
    expiresAt: now() + 10 * 60 * 1000,
  });
}

export async function fetchPumpfunMarketCap(
  mintAddress: string
): Promise<number | null> {
  const token = process.env.BITQUERY_API_TOKEN ?? '';

  if (!token || !mintAddress) {
    return null;
  }

  const cached = getCachedMarketCap(mintAddress);
  if (cached !== undefined) {
    return cached;
  }

  if (bitqueryBackoffUntil > now()) {
    const waitSec = Math.ceil((bitqueryBackoffUntil - now()) / 1000);
    console.log('pumpfun market cap skipped due to Bitquery backoff:', {
      mintAddress,
      waitSec,
    });
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

      const lower = text.toLowerCase();

      if (
        res.status === 403 ||
        res.status === 402 ||
        lower.includes('points limit exceeded') ||
        lower.includes('usage quota')
      ) {
        bitqueryBackoffUntil = now() + 30 * 60 * 1000;

        console.log('pumpfun market cap Bitquery quota backoff:', {
          mintAddress,
          status: res.status,
          waitMin: 30,
          body: text.slice(0, 250),
        });

        setCachedMarketCap(mintAddress, null);
        return null;
      }

      console.log('pumpfun market cap request failed:', {
        mintAddress,
        status: res.status,
        body: text.slice(0, 250),
      });

      setCachedMarketCap(mintAddress, null);
      return null;
    }

    const json = await res.json();

    if (json?.errors?.length) {
      const errorText = JSON.stringify(json.errors).toLowerCase();

      if (
        errorText.includes('points limit exceeded') ||
        errorText.includes('usage quota')
      ) {
        bitqueryBackoffUntil = now() + 30 * 60 * 1000;

        console.log('pumpfun market cap GraphQL quota backoff:', {
          mintAddress,
          waitMin: 30,
          errors: json.errors,
        });

        setCachedMarketCap(mintAddress, null);
        return null;
      }

      console.log('pumpfun market cap graphql errors:', {
        mintAddress,
        errors: json.errors,
      });

      setCachedMarketCap(mintAddress, null);
      return null;
    }

    const row = json?.data?.Solana?.DEXTradeByTokens?.[0];
    const marketCap = Number(row?.Trade?.Market?.Marketcap ?? 0);

    if (!Number.isFinite(marketCap) || marketCap <= 0) {
      setCachedMarketCap(mintAddress, null);
      return null;
    }

    setCachedMarketCap(mintAddress, marketCap);
    return marketCap;
  } catch (err) {
    console.log('pumpfun market cap fetch error:', {
      mintAddress,
      error: err instanceof Error ? err.message : String(err),
    });

    setCachedMarketCap(mintAddress, null);
    return null;
  }
}