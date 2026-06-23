import { config } from '../config.js';
import { recordCreatorLaunch } from '../agents/creatorIntelligenceAgent.js';

import {
  saveCreatorLaunch,
  getProvenCreator,
} from './creatorIntelStore.js';

export type PumpfunTokenEvent = {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  creator?: string | null;
  uri?: string | null;
  isMutable?: boolean | null;
  buyCount?: number | null;
  sellCount?: number | null;
  volumeUsd?: number | null;
  marketCapUsd?: number | null;
  progressPct?: number | null;
  launchScore?: number | null;
  buyVelocityScore?: number | null;
};

const seenPumpfunMints = new Set<string>();
const seenCreators = new Map<string, number>();

let bitqueryBackoffUntil = 0;

function now() {
  return Date.now();
}

function looksLikeJunkSymbol(symbol?: string | null) {
  if (!symbol) return true;

  const s = symbol.trim().toUpperCase();

  if (!s) return true;
  if (s.length < 2) return true;
  if (s.length > 15) return true;

  const bannedWords = [
    'TEST',
    'SCAM',
    'RUG',
    'DUMP',
    'MAYHEM',
    'ITSOVER',
    'OVER',
    'DEAD',
    'KILL',
    'TRASH',
    'JEET',
    'EXIT',
    'LOSS',
    'FAIL',
    'FUCK',
    'SHIT',
    'PUMPDUMP',
    'MURDER',
  ];

  if (bannedWords.some((x) => s.includes(x))) return true;

  if (/^(.)\1{3,}$/.test(s)) return true;

  const cleaned = s.replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return true;
  if (cleaned.length < Math.ceil(s.length * 0.6)) return true;

  return false;
}

function looksLikeJunkName(name?: string | null) {
  if (!name) return true;

  const n = name.trim().toUpperCase();

  if (!n) return true;
  if (n.length < 2) return true;
  if (n.length > 40) return true;

  const bannedWords = [
    'SCAM',
    'RUG',
    'DUMP',
    'MAYHEM',
    'ITS OVER',
    'ITSOVER',
    'DEAD',
    'KILL',
    'TRASH',
    'JEET',
    'EXIT',
    'LOSS',
    'FAIL',
    'MURDER',
  ];

  if (bannedWords.some((x) => n.includes(x))) return true;
  if (/^(.)\1{4,}$/.test(n.replace(/\s+/g, ''))) return true;

  return false;
}

function getLaunchScore(args: {
  symbol?: string | null;
  name?: string | null;
  creatorSeen: number;
  isMutable?: boolean | null;
}) {
  let score = 0;

  if (!looksLikeJunkSymbol(args.symbol)) score += 40;
  if (!looksLikeJunkName(args.name)) score += 40;

  if (args.creatorSeen === 0) score += 15;
  else if (args.creatorSeen < 2) score += 8;

  if (args.isMutable === false) score += 20;
  else score -= 10;

  return score;
}

async function fetchPumpfunEarlyTokens(): Promise<PumpfunTokenEvent[]> {
  const token = process.env.BITQUERY_API_TOKEN ?? '';
  if (!token) {
    console.log('pumpfun: missing BITQUERY_API_TOKEN');
    return [];
  }

  if (process.env.PUMPFUN_WATCH_ENABLED !== 'true') {
    console.log('pumpfun: watcher disabled');
    return [];
  }

  if (bitqueryBackoffUntil > now()) {
    const waitSec = Math.ceil((bitqueryBackoffUntil - now()) / 1000);
    console.log(`pumpfun: in backoff for ${waitSec}s`);
    return [];
  }

  const query = `
query PumpfunEarlyFeed {
  Solana(dataset: realtime) {
    TokenSupplyUpdates(
      limit: { count: 5 }
      orderBy: { descending: Block_Time }
      where: {
        Instruction: {
          Program: {
            Method: { in: ["create", "create_v2"] }
            Address: { is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" }
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
          Name
          Symbol
          Uri
          IsMutable
        }
      }
      Transaction {
        Signer
      }
    }
  }
}
`;

  const res = await fetch('https://streaming.bitquery.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
  const text = await res.text().catch(() => '');
  const lower = text.toLowerCase();

  if (
    res.status === 402 ||
    res.status === 403 ||
    lower.includes('points limit exceeded') ||
    lower.includes('usage quota')
  ) {
    bitqueryBackoffUntil = now() + 30 * 60 * 1000;
    console.log('pumpfun: Bitquery quota exceeded, backing off for 30 minutes', {
      status: res.status,
      body: text.slice(0, 200),
    });
    return [];
  }

  throw new Error(`Bitquery request failed: ${res.status} ${text}`);
}

  const json = await res.json();

  if (json?.errors?.length) {
    console.log('pumpfun graphql errors:', json.errors);

    const hasPointsError = json.errors.some((e: any) =>
      String(e?.message ?? '').toLowerCase().includes('points limit exceeded')
    );

    if (hasPointsError) {
      bitqueryBackoffUntil = now() + 30 * 60 * 1000;
      console.log('pumpfun: GraphQL points exceeded, backing off for 30 minutes');
      return [];
    }
  }

  const rows = json?.data?.Solana?.TokenSupplyUpdates ?? [];
  console.log('pumpfun rows fetched:', rows.length);

  return rows
    .map((row: any) => {
      const mint = row?.TokenSupplyUpdate?.Currency?.MintAddress;
      if (!mint) return null;

      return {
        mint,
        symbol: row?.TokenSupplyUpdate?.Currency?.Symbol ?? null,
        name: row?.TokenSupplyUpdate?.Currency?.Name ?? null,
        creator: row?.Transaction?.Signer ?? null,
        uri: row?.TokenSupplyUpdate?.Currency?.Uri ?? null,
        isMutable: row?.TokenSupplyUpdate?.Currency?.IsMutable ?? null,
        buyCount: null,
        sellCount: null,
        volumeUsd: null,
        marketCapUsd: null,
        progressPct: 0,
        launchScore: null,
      } satisfies PumpfunTokenEvent;
    })
    .filter((x): x is PumpfunTokenEvent => Boolean(x));
}

export async function pollPumpfunEarlyFeed(): Promise<PumpfunTokenEvent[]> {
  const tokens = await fetchPumpfunEarlyTokens();
  const events: PumpfunTokenEvent[] = [];

  for (const token of tokens) {
    if (!token?.mint) continue;
    if (seenPumpfunMints.has(token.mint)) continue;

    const symbol = token.symbol ?? '';
    const name = token.name ?? '';
    const creator = token.creator ?? '';
    const creatorSeen = creator ? (seenCreators.get(creator) ?? 0) : 0;

    const launchScore = getLaunchScore({
      symbol,
      name,
      creatorSeen,
      isMutable: token.isMutable,
    });

    const buyVelocityScore =
      (token.buyCount ?? 0) * 2 - (token.sellCount ?? 0);

    token.buyVelocityScore = buyVelocityScore;

    console.log('pumpfun candidate:', {
      mint: token.mint,
      symbol,
      name,
      creator,
      creatorSeen,
      launchScore,
    });

    try {
  await saveCreatorLaunch({
    creatorWallet: creator || null,
    token: token.mint,
    symbol: symbol || null,
    name: name || null,
    initialMarketCap: token.marketCapUsd ?? null,
  });

  console.log('creator launch saved:', {
    creator,
    token: token.mint,
    symbol,
  });
} catch (err) {
  console.log('creator save failed:', err);
}

    const passes =
      !looksLikeJunkSymbol(symbol) &&
      !looksLikeJunkName(name) &&
      creatorSeen < 2 &&
      launchScore >= 75;

    await recordCreatorLaunch({
      creatorWallet: token.creator ?? null,
      token: token.mint,
      symbol: token.symbol ?? token.name ?? null,
      marketCap: token.marketCapUsd ?? null,
      sourceAgent: 'PumpFunDiscoveryAgent',
      rawData: token as unknown as Record<string, unknown>,
    });

    if (!passes) {
      console.log('pumpfun rejected:', {
        mint: token.mint,
        symbol,
        name,
        reason: {
          symbolOk: !looksLikeJunkSymbol(symbol),
          nameOk: !looksLikeJunkName(name),
          creatorOk: creatorSeen < 2,
          launchScore,
        },
      });
      continue;
    }

    token.launchScore = launchScore;

    console.log('pumpfun passed:', {
      mint: token.mint,
      symbol,
      name,
      creator,
      launchScore,
    });

    seenPumpfunMints.add(token.mint);

if (creator) {
  seenCreators.set(creator, creatorSeen + 1);
}


// ✅ CHECK IF PROVEN CREATOR
try {
  const proven = await getProvenCreator(creator);

  if (proven) {
    console.log('🚨 PROVEN CREATOR LAUNCH DETECTED:', {
      creator,
      token: token.mint,
      symbol,
      bestToken: proven.best_token,
      bestMarketCap: proven.best_market_cap,
    });

    // 👉 Later we will send Telegram alert here
  }
} catch (err) {
  console.log('proven creator check failed:', err);
}

events.push(token);
  }

  return events;
}