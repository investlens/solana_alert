import { config } from '../config.js';
import { createEnhancedTransactionReader } from './enhancedTransactionReader.js';
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

const EMPTY_AUTHORITY_INFO: AuthorityInfo = {
  mintAuthority: null,
  freezeAuthority: null,
  updateAuthority: null,
  isMutable: null,
};

const authorityCache = new Map<string, { data: AuthorityInfo; cachedAt: number }>();

const AUTHORITY_CACHE_TTL_MS = 30 * 60 * 1000;
const HELIUS_BACKOFF_MS = 5 * 60 * 1000;

let heliusBackoffUntil = 0;

function now() {
  return Date.now();
}

function getCachedAuthorityInfo(mintAddress: string): AuthorityInfo | null {
  const cached = authorityCache.get(mintAddress);

  if (!cached) return null;

  if (now() - cached.cachedAt > AUTHORITY_CACHE_TTL_MS) {
    authorityCache.delete(mintAddress);
    return null;
  }

  return cached.data;
}

function setCachedAuthorityInfo(mintAddress: string, data: AuthorityInfo) {
  authorityCache.set(mintAddress, {
    data,
    cachedAt: now(),
  });
}

export async function fetchAuthorityInfo(mintAddress: string): Promise<AuthorityInfo> {
  if (!config.heliusApiKey) {
    return EMPTY_AUTHORITY_INFO;
  }

  const cached = getCachedAuthorityInfo(mintAddress);
  if (cached) {
    return cached;
  }

  if (heliusBackoffUntil > now()) {
    const waitSec = Math.ceil((heliusBackoffUntil - now()) / 1000);
    console.log(`Helius token-metadata backoff active: ${waitSec}s remaining`);
    return EMPTY_AUTHORITY_INFO;
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

      if (res.status === 429) {
        heliusBackoffUntil = now() + HELIUS_BACKOFF_MS;
        console.log('Helius token-metadata 429, backing off 5 minutes');

        setCachedAuthorityInfo(mintAddress, EMPTY_AUTHORITY_INFO);
        return EMPTY_AUTHORITY_INFO;
      }

      console.error('Helius token-metadata failed:', res.status, text);
      setCachedAuthorityInfo(mintAddress, EMPTY_AUTHORITY_INFO);
      return EMPTY_AUTHORITY_INFO;
    }

    const data = (await res.json()) as HeliusTokenMetadataResponse;
    const token = data?.[0];

    const authorityInfo: AuthorityInfo = {
      mintAuthority: token?.onChainMetadata?.mintAuthority ?? null,
      freezeAuthority: token?.onChainMetadata?.freezeAuthority ?? null,
      updateAuthority: token?.onChainMetadata?.metadata?.updateAuthority ?? null,
      isMutable: token?.onChainMetadata?.metadata?.isMutable ?? null,
    };

    setCachedAuthorityInfo(mintAddress, authorityInfo);
    return authorityInfo;
  } catch (error) {
    console.error('fetchAuthorityInfo error:', error);
    setCachedAuthorityInfo(mintAddress, EMPTY_AUTHORITY_INFO);
    return EMPTY_AUTHORITY_INFO;
  }
}

export type HeliusEnhancedTx = {
  description?: string;
  type?: string;
  signature?: string;
  timestamp?: number;
  source?: string;
  nativeTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    amount?: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount?: string;
    toUserAccount?: string;
    mint?: string;
    tokenAmount?: number;
  }>;
};

const enhancedTransactionReader = createEnhancedTransactionReader<HeliusEnhancedTx>(() => config.heliusApiKey);

export async function fetchEnhancedTransactionsForAddress(address: string, limit = 50): Promise<HeliusEnhancedTx[]> {
  return enhancedTransactionReader(address, limit);
}

let holderRiskBackoffUntil = 0;

export type HolderInfo = {
  owner: string;
  amount: number;
};

export async function fetchTopHolders(
  mintAddress: string
): Promise<HolderInfo[]> {
  if (!config.heliusApiKey) return [];

  if (Date.now() < holderRiskBackoffUntil) {
    const waitSec = Math.ceil(
      (holderRiskBackoffUntil - Date.now()) / 1000
    );

    console.log(
      `Helius holder backoff active: ${waitSec}s remaining`
    );

    return [];
  }

  const url =
    `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'holders',
        method: 'getTokenLargestAccounts',
        params: [mintAddress],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      if (res.status === 429) {
        holderRiskBackoffUntil =
          Date.now() + 10 * 60 * 1000;

        console.log(
          'Helius holder endpoint rate limited, backing off 10 minutes'
        );

        return [];
      }

      console.log('fetchTopHolders failed:', {
        status: res.status,
        body: text,
      });

      return [];
    }

    const json = await res.json();
    const values = json?.result?.value ?? [];

    return values.map((value: any) => ({
      owner: value.address,
      amount: Number(
        value.uiAmount ??
        value.uiAmountString ??
        value.amount ??
        0
      ),
    }));
  } catch (error) {
    console.log(
      'fetchTopHolders error:',
      error instanceof Error
        ? error.message
        : String(error)
    );

    return [];
  }
}