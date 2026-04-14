import { config } from '../config.js';
import type { AuthorityInfo } from '../types.js';

type HeliusTokenMetadataResponse = Array<{
  onChainMetadata?: {
    metadata?: {
      updateAuthority?: string | null;
      mint?: string | null;
      data?: {
        name?: string;
        symbol?: string;
      };
      isMutable?: boolean | null;
    } | null;
    mintAuthority?: string | null;
    freezeAuthority?: string | null;
  } | null;
}>;

export async function fetchAuthorityInfo(mintAddress: string): Promise<AuthorityInfo> {
  if (!config.heliusApiKey) {
    return {
      mintAuthority: null,
      freezeAuthority: null,
      updateAuthority: null,
      isMutable: null,
    };
  }

  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/token-metadata?api-key=${config.heliusApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mintAccounts: [mintAddress],
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Helius token-metadata failed:', res.status, text);

      return {
        mintAuthority: null,
        freezeAuthority: null,
        updateAuthority: null,
        isMutable: null,
      };
    }

    const data = (await res.json()) as HeliusTokenMetadataResponse;
    const token = data?.[0];

    const mintAuthority = token?.onChainMetadata?.mintAuthority ?? null;
    const freezeAuthority = token?.onChainMetadata?.freezeAuthority ?? null;
    const updateAuthority =
      token?.onChainMetadata?.metadata?.updateAuthority ?? null;
    const isMutable =
      token?.onChainMetadata?.metadata?.isMutable ?? null;

    return {
      mintAuthority,
      freezeAuthority,
      updateAuthority,
      isMutable,
    };
  } catch (error) {
    console.error('fetchAuthorityInfo error:', error);

    return {
      mintAuthority: null,
      freezeAuthority: null,
      updateAuthority: null,
      isMutable: null,
    };
  }
}