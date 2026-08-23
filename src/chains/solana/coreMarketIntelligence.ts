import { Connection, PublicKey } from '@solana/web3.js';

import { config } from '../../config.js';
import { getCreatorWalletForToken } from '../../profiles/tokenCreatorLookup.js';

export type SolanaMetricEvidence = {
  value: number | null;
  state: 'VERIFIED' | 'UNAVAILABLE';
  source: string | null;
  observedAt: string;
  reason?: string;
};

export type SolanaCoreMarketIntelligence = {
  mint: string;
  creator: string | null;
  devHolding: SolanaMetricEvidence;
  burn: SolanaMetricEvidence;
};

export function mergeSolanaCoreMarketIntelligence(
  raw: Record<string, unknown> | null | undefined,
  evidence: SolanaCoreMarketIntelligence,
): Record<string, unknown> {
  return {
    ...(raw ?? {}),
    ...(evidence.devHolding.state === 'VERIFIED' && evidence.devHolding.value != null
      ? {
          devHoldingPercent: evidence.devHolding.value,
          devHoldingEvidence: 'VERIFIED',
          devHoldingSource: evidence.devHolding.source,
          devHoldingObservedAt: evidence.devHolding.observedAt,
          deployerAddress: evidence.creator,
        }
      : {}),
    ...(evidence.burn.state === 'VERIFIED' && evidence.burn.value != null
      ? {
          totalBurnPercent: evidence.burn.value,
          burnEvidence: 'VERIFIED',
          burnSource: evidence.burn.source,
          burnObservedAt: evidence.burn.observedAt,
        }
      : {}),
  };
}

export type SolanaTokenAccountMeasurement = {
  mint: string;
  amountRaw: string;
};

type EvidenceDependencies = {
  resolveCreator: (mint: string) => Promise<string | null>;
  readSupply: (mint: string) => Promise<string>;
  readCreatorAccounts: (
    creator: string,
    mint: string,
  ) => Promise<SolanaTokenAccountMeasurement[]>;
  now?: () => Date;
};

const SUCCESS_TTL_MS = 5 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const ENRICHMENT_TIMEOUT_MS = 2_500;
const cache = new Map<string, { expiresAt: number; result: SolanaCoreMarketIntelligence }>();
const inFlight = new Map<string, Promise<SolanaCoreMarketIntelligence>>();
let connection: Connection | null = null;

function unavailable(observedAt: string, reason: string): SolanaMetricEvidence {
  return { value: null, state: 'UNAVAILABLE', source: null, observedAt, reason };
}

function percent(balance: bigint, supply: bigint): number {
  return Number(balance * 1_000_000n / supply) / 10_000;
}

export function calculateSolanaDevHolding(args: {
  mint: string;
  supplyRaw: string;
  accounts: SolanaTokenAccountMeasurement[];
}): number {
  const supply = BigInt(args.supplyRaw);
  if (supply <= 0n) throw new Error('Token supply is unavailable');

  let balance = 0n;
  for (const account of args.accounts) {
    if (account.mint !== args.mint) {
      throw new Error('Creator token account mint mismatch');
    }
    const amount = BigInt(account.amountRaw);
    if (amount < 0n) throw new Error('Creator token balance is invalid');
    balance += amount;
  }
  return percent(balance, supply);
}

export function classifySolanaTokenInstruction(
  instructionType: string,
): 'BURN' | 'TRANSFER' | 'OTHER' {
  const type = instructionType.trim().toLowerCase();
  if (type === 'burn' || type === 'burnchecked') return 'BURN';
  if (type === 'transfer' || type === 'transferchecked') return 'TRANSFER';
  return 'OTHER';
}

export async function resolveSolanaCoreMarketIntelligence(
  mint: string,
  deps: EvidenceDependencies,
): Promise<SolanaCoreMarketIntelligence> {
  const observedAt = (deps.now?.() ?? new Date()).toISOString();
  try {
    const creator = await deps.resolveCreator(mint);
    if (!creator) {
      return {
        mint, creator: null,
        devHolding: unavailable(observedAt, 'Verified creator is unavailable'),
        burn: unavailable(observedAt, 'No verified SPL burn baseline or burn history'),
      };
    }

    const [supplyRaw, accounts] = await Promise.all([
      deps.readSupply(mint),
      deps.readCreatorAccounts(creator, mint),
    ]);
    const holding = calculateSolanaDevHolding({ mint, supplyRaw, accounts });
    return {
      mint,
      creator,
      devHolding: {
        value: holding,
        state: 'VERIFIED',
        source: 'SOLANA_RPC_CREATOR_BALANCE_OVER_MINT_SUPPLY',
        observedAt,
      },
      // Current SPL supply alone cannot prove how much supply was burned.
      burn: unavailable(observedAt, 'No verified SPL burn baseline or burn history'),
    };
  } catch (error) {
    return {
      mint,
      creator: null,
      devHolding: unavailable(observedAt, error instanceof Error ? error.message : String(error)),
      burn: unavailable(observedAt, 'No verified SPL burn baseline or burn history'),
    };
  }
}

function getConnection(): Connection {
  connection ??= new Connection(config.solanaRpcUrl, 'confirmed');
  return connection;
}

async function productionResolution(mint: string): Promise<SolanaCoreMarketIntelligence> {
  return resolveSolanaCoreMarketIntelligence(mint, {
    resolveCreator: getCreatorWalletForToken,
    readSupply: async (address) => {
      const result = await getConnection().getTokenSupply(new PublicKey(address), 'confirmed');
      return result.value.amount;
    },
    readCreatorAccounts: async (creator, address) => {
      const result = await getConnection().getParsedTokenAccountsByOwner(
        new PublicKey(creator),
        { mint: new PublicKey(address) },
        'confirmed',
      );
      return result.value.map(({ account }) => {
        const info = account.data.parsed?.info;
        return {
          mint: String(info?.mint ?? ''),
          amountRaw: String(info?.tokenAmount?.amount ?? ''),
        };
      });
    },
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Solana evidence lookup timed out')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function getSolanaCoreMarketIntelligence(
  mint: string,
): Promise<SolanaCoreMarketIntelligence> {
  const cached = cache.get(mint);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  const pending = inFlight.get(mint);
  if (pending) return pending;

  const request = withTimeout(productionResolution(mint), ENRICHMENT_TIMEOUT_MS)
    .catch((error): SolanaCoreMarketIntelligence => {
      const observedAt = new Date().toISOString();
      return {
        mint, creator: null,
        devHolding: unavailable(observedAt, error instanceof Error ? error.message : String(error)),
        burn: unavailable(observedAt, 'No verified SPL burn baseline or burn history'),
      };
    })
    .then((result) => {
      cache.set(mint, {
        result,
        expiresAt: Date.now() + (result.devHolding.state === 'VERIFIED' ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
      });
      return result;
    })
    .finally(() => inFlight.delete(mint));
  inFlight.set(mint, request);
  return request;
}
