export async function fetchDexscreenerPairMarketCap(
  token: string
): Promise<number | null> {
  if (!token) return null;

  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${token}`);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log('dexscreener pairs fetch failed:', {
        token,
        status: res.status,
        body: text.slice(0, 200),
      });
      return null;
    }

    const pairs = await res.json();

    if (!Array.isArray(pairs) || !pairs.length) {
      return null;
    }

    const bestPair = pairs
      .filter((p) => p?.baseToken?.address === token)
      .sort(
        (a, b) =>
          Number(b?.liquidity?.usd ?? 0) - Number(a?.liquidity?.usd ?? 0)
      )[0];

    const marketCap = Number(bestPair?.marketCap ?? bestPair?.fdv ?? 0);

    if (!Number.isFinite(marketCap) || marketCap <= 0) {
      return null;
    }

    return marketCap;
  } catch (err) {
    console.log('dexscreener pairs market cap error:', {
      token,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}