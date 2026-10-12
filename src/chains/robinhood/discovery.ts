import type {
  ChainMarketSnapshot,
} from '../shared/types.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';
import { governedDexScreenerJson } from '../../services/dexscreenerRequestGovernor.js';

const ROBINHOOD_CHAIN_ID =
  'robinhood';

const TOKEN_PROFILES_URL =
  'https://api.dexscreener.com/token-profiles/latest/v1';

const TOKEN_BOOSTS_URL =
  'https://api.dexscreener.com/token-boosts/latest/v1';
const TOKEN_BOOSTS_TOP_URL='https://api.dexscreener.com/token-boosts/top/v1';

type DexTokenProfile = {
  chainId?: string;
  tokenAddress?: string;
  url?: string;
};

type DexBoostToken = {
  chainId?: string;
  tokenAddress?: string;
  amount?: number;
  totalAmount?: number;
};

export type RobinhoodDiscoveryCandidate = {
  tokenAddress: string;

  symbol: string;
  name: string;

  pairAddress?: string;
  dexId?: string;

  priceUsd: number;

  marketCapUsd: number;
  liquidityUsd: number;
  volume5mUsd: number;

  buys5m: number;
  sells5m: number;

  buyRatio: number;

  activityScore: number;

  source:
    | 'PROFILE'
    | 'BOOST'
    | 'PROFILE+BOOST';
};

async function fetchJson<T>(
  url: string,
): Promise<T> {
  return (await governedDexScreenerJson<T>({ url, caller: 'robinhood_discovery', priority: url === TOKEN_BOOSTS_URL ? 'HIGH' : 'BACKGROUND',
    endpoint: url === TOKEN_PROFILES_URL ? 'PROFILES' : 'BOOSTS', cacheTtlMs: url === TOKEN_PROFILES_URL || url === TOKEN_BOOSTS_TOP_URL ? 60_000 : 15_000 })).value;
}

function calculateBuyRatio(
  buys: number,
  sells: number,
): number {
  if (sells <= 0) {
    return buys > 0
      ? buys
      : 0;
  }

  return buys / sells;
}

function calculateActivityScore(
  snapshot: ChainMarketSnapshot,
): number {
  /*
   * Discovery ranking only.
   *
   * This is NOT AlphaOS BUY scoring.
   */

  const liquidityComponent =
    Math.log10(
      Math.max(
        snapshot.liquidityUsd,
        1,
      ),
    ) * 2;

  const volumeComponent =
    Math.log10(
      Math.max(
        snapshot.volume5mUsd,
        1,
      ),
    ) * 3;

  const transactionCount =
    snapshot.buys5m +
    snapshot.sells5m;

  const activityComponent =
    Math.log10(
      Math.max(
        transactionCount,
        1,
      ),
    ) * 2;

  const buyRatio =
    calculateBuyRatio(
      snapshot.buys5m,
      snapshot.sells5m,
    );

  const pressureComponent =
    Math.min(
      Math.max(
        buyRatio,
        0,
      ),
      5,
    );

  return (
    liquidityComponent +
    volumeComponent +
    activityComponent +
    pressureComponent
  );
}

async function fetchRobinhoodProfiles():
  Promise<string[]> {
  try {
    const profiles =
      await fetchJson<
        DexTokenProfile[]
      >(TOKEN_PROFILES_URL);

    if (!Array.isArray(profiles)) {
      return [];
    }

    return profiles
      .filter(
        (profile) =>
          profile.chainId ===
            ROBINHOOD_CHAIN_ID &&
          Boolean(
            profile.tokenAddress,
          ),
      )
      .map(
        (profile) =>
          profile.tokenAddress!,
      );
  } catch (error) {
    console.error(
      '[RobinhoodDiscovery] Profile feed failed:',
      error,
    );

    return [];
  }
}

export type RobinhoodBoostEntry = {
  tokenAddress: string;
  amount: number;
  totalAmount: number;
  source?:'LATEST'|'TOP';
};

export async function fetchRobinhoodBoosts():
Promise<RobinhoodBoostEntry[]> {
  try {
    const boosts =
      await fetchJson<
        DexBoostToken[]
      >(TOKEN_BOOSTS_URL);

    if (!Array.isArray(boosts)) {
      throw new Error('Malformed DexScreener boost feed');
    }

    const latest=boosts
      .filter(
        (boost) =>
          boost.chainId ===
            ROBINHOOD_CHAIN_ID &&
          Boolean(
            boost.tokenAddress,
          ),
      )
      .map(
        (boost) => ({
          tokenAddress:
            boost.tokenAddress!,

          amount:
            Number(
              boost.amount ??
              0,
            ),

          totalAmount:
            Number(
              boost.totalAmount ??
              0,
            ),
        }),
      );
    // One cached TOP read/minute catches increments after tokens leave LATEST.
    // First appearances in TOP are baselines, not proof of a new purchase.
    const merged=new Map<string,RobinhoodBoostEntry>(latest.filter(row=>/^0x[a-f0-9]{40}$/i.test(row.tokenAddress)&&Number.isFinite(row.totalAmount)&&row.totalAmount>0&&Number.isFinite(row.amount)&&row.amount>=0&&row.amount<=row.totalAmount).map(row=>[row.tokenAddress.toLowerCase(),{...row,source:'LATEST' as const}] as const));
    try{
      const top=await fetchJson<DexBoostToken[]>(TOKEN_BOOSTS_TOP_URL);
      if(!Array.isArray(top))throw Error('Malformed TOP boost feed');
      for(const item of top.slice(0,200)){
        if(item.chainId!==ROBINHOOD_CHAIN_ID||!/^0x[a-f0-9]{40}$/i.test(item.tokenAddress??''))continue;
        const row:RobinhoodBoostEntry={tokenAddress:item.tokenAddress!,amount:Number(item.amount),totalAmount:Number(item.totalAmount),source:'TOP'};
        if(!Number.isFinite(row.amount)||row.amount<0||!Number.isFinite(row.totalAmount)||row.totalAmount<=0||row.amount>row.totalAmount)continue;
        const prior=merged.get(row.tokenAddress.toLowerCase());
        if(!prior||row.totalAmount>prior.totalAmount)merged.set(row.tokenAddress.toLowerCase(),row);
      }
    }catch{console.warn('[RobinhoodDiscovery] TOP boost coverage unavailable; LATEST remains active');}
    return [...merged.values()];
  } catch (error) {
    console.error(
      '[RobinhoodDiscovery] Boost feed failed:',
      error,
    );

    throw error;
  }
}

function buildSourceMap(
  profiles: string[],
  boosts: string[],
) {
  const sourceMap =
    new Map<
      string,
      {
        tokenAddress: string;
        profile: boolean;
        boost: boolean;
      }
    >();

  for (const tokenAddress of profiles) {
    const key =
      tokenAddress.toLowerCase();

    const existing =
      sourceMap.get(key);

    sourceMap.set(
      key,
      {
        tokenAddress,
        profile: true,
        boost:
          existing?.boost ??
          false,
      },
    );
  }

  for (const tokenAddress of boosts) {
    const key =
      tokenAddress.toLowerCase();

    const existing =
      sourceMap.get(key);

    sourceMap.set(
      key,
      {
        tokenAddress,
        profile:
          existing?.profile ??
          false,
        boost: true,
      },
    );
  }

  return sourceMap;
}

function getSourceLabel(args: {
  profile: boolean;
  boost: boolean;
}):
  | 'PROFILE'
  | 'BOOST'
  | 'PROFILE+BOOST' {
  if (
    args.profile &&
    args.boost
  ) {
    return 'PROFILE+BOOST';
  }

  if (args.boost) {
    return 'BOOST';
  }

  return 'PROFILE';
}

export async function discoverRobinhoodCandidates(
  limit = 25,
): Promise<
  RobinhoodDiscoveryCandidate[]
> {
  const [
    profiles,
    boosts,
  ] =
    await Promise.all([
      fetchRobinhoodProfiles(),
      fetchRobinhoodBoosts().catch(() => []),
    ]);

    const boostAddresses =
      boosts.map(
        (boost) =>
          boost.tokenAddress,
      );

  console.log(
    '[RobinhoodDiscovery] Sources:',
    {
      profiles:
        profiles.length,
      boosts:
        boosts.length,
    },
  );

  const sourceMap =
    buildSourceMap(
      profiles,
      boostAddresses,
    );

  console.log(
    '[RobinhoodDiscovery] Unique tokens:',
    sourceMap.size,
  );

  const candidates:
    RobinhoodDiscoveryCandidate[] =
      [];

  /*
   * Sequential on purpose for now.
   *
   * Once production infrastructure is ready,
   * we can use controlled concurrency.
   */
  for (
    const sourceInfo
    of sourceMap.values()
  ) {
    try {
      const snapshot =
        await getRobinhoodMarketSnapshot(
          sourceInfo.tokenAddress,
          { priority: 'BACKGROUND', caller: 'robinhood_discovery' },
        );

      if (!snapshot) {
        continue;
      }

      const buyRatio =
        calculateBuyRatio(
          snapshot.buys5m,
          snapshot.sells5m,
        );

      candidates.push({
        tokenAddress:
          snapshot.tokenAddress,

        symbol:
          snapshot.symbol,

        name:
          snapshot.name,

        pairAddress:
          snapshot.pairAddress,

        dexId:
          snapshot.dexId,

        priceUsd:
          snapshot.priceUsd,

        marketCapUsd:
          snapshot.marketCapUsd,

        liquidityUsd:
          snapshot.liquidityUsd,

        volume5mUsd:
          snapshot.volume5mUsd,

        buys5m:
          snapshot.buys5m,

        sells5m:
          snapshot.sells5m,

        buyRatio,

        activityScore:
          calculateActivityScore(
            snapshot,
          ),

        source:
          getSourceLabel(
            sourceInfo,
          ),
      });
    } catch (error) {
      console.error(
        '[RobinhoodDiscovery] Token enrichment failed:',
        {
          token:
            sourceInfo.tokenAddress,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
  }

  return candidates
    .sort(
      (a, b) =>
        b.activityScore -
        a.activityScore,
    )
    .slice(
      0,
      Math.max(
        1,
        limit,
      ),
    );
}

export async function discoverRobinhoodSnapshots(
  limit = 10,
): Promise<
  ChainMarketSnapshot[]
> {
  const candidates =
    await discoverRobinhoodCandidates(
      limit,
    );

  const snapshots:
    ChainMarketSnapshot[] =
      [];

  for (
    const candidate
    of candidates
  ) {
    const snapshot =
      await getRobinhoodMarketSnapshot(
        candidate.tokenAddress,
        { priority: 'BACKGROUND', caller: 'robinhood_discovery' },
      );

    if (snapshot) {
      snapshots.push(
        snapshot,
      );
    }
  }

  return snapshots;
}
