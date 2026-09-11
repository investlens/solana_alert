import { Connection, PublicKey } from '@solana/web3.js';
import { recordCreatorLaunch } from '../agents/creatorIntelligenceAgent.js';
import { saveCreatorLaunch } from './creatorIntelStore.js';

const PUMPFUN_PROGRAM = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
);

let started = false;
let subscriptionId: number | null = null;

function keyToString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;

  const maybe = value as {
    pubkey?: { toBase58?: () => string } | string;
    toBase58?: () => string;
  };

  if (typeof maybe.toBase58 === 'function') {
    return maybe.toBase58();
  }

  if (typeof maybe.pubkey === 'string') {
    return maybe.pubkey;
  }

  if (maybe.pubkey && typeof maybe.pubkey.toBase58 === 'function') {
    return maybe.pubkey.toBase58();
  }

  return null;
}

/**
 * Starts a creator-launch-only fallback for Pump.fun.
 *
 * This does not replace the existing Bitquery discovery path and it does not
 * emit normal token alerts or execute trades. It only restores the creator
 * launch records needed by Creator Intelligence when Bitquery is unavailable.
 *
 * Helius documents Pump.fun creation detection by subscribing to the Pump.fun
 * program and matching the `Instruction: InitializeMint2` log. In those create
 * transactions account key 0 is the creator and account key 1 is the new mint.
 */
export async function ensurePumpfunHeliusCreatorFallbackStarted(): Promise<void> {
  if (started) return;

  const apiKey = process.env.HELIUS_API_KEY ?? '';
  if (!apiKey) {
    console.log('[PumpfunHeliusFallback] unavailable: HELIUS_API_KEY missing');
    return;
  }

  started = true;

  const httpEndpoint =
    `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
  const wsEndpoint =
    `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;

  const connection = new Connection(httpEndpoint, {
    commitment: 'confirmed',
    wsEndpoint,
  });

  try {
    subscriptionId = connection.onLogs(
      PUMPFUN_PROGRAM,
      async (logInfo) => {
        try {
          if (logInfo.err) return;

          const isCreate = (logInfo.logs ?? []).some((line) =>
            line.includes('Instruction: InitializeMint2')
          );

          if (!isCreate) return;

          const tx = await connection.getParsedTransaction(logInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          const keys = tx?.transaction.message.accountKeys ?? [];
          const creatorWallet = keyToString(keys[0]);
          const token = keyToString(keys[1]);

          if (!creatorWallet || !token) {
            console.log('[PumpfunHeliusFallback] create parse incomplete', {
              signature: logInfo.signature,
              creatorWallet,
              token,
            });
            return;
          }

          await saveCreatorLaunch({
            creatorWallet,
            token,
            symbol: null,
            name: null,
            initialMarketCap: null,
          });

          await recordCreatorLaunch({
            creatorWallet,
            token,
            chain: 'solana',
            symbol: null,
            marketCap: null,
            sourceAgent: 'PumpFunHeliusFallback',
            rawData: {
              signature: logInfo.signature,
              source: 'HELIUS_PUMPFUN_CREATE_LOG',
            },
          });

          console.log('[PumpfunHeliusFallback] creator launch recorded', {
            creatorWallet,
            token,
            signature: logInfo.signature,
          });
        } catch (error) {
          console.log('[PumpfunHeliusFallback] transaction error', {
            signature: logInfo.signature,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      'confirmed'
    );

    console.log('[PumpfunHeliusFallback] active', {
      subscriptionId,
      purpose: 'creator-launch-ingestion-only',
    });
  } catch (error) {
    started = false;
    subscriptionId = null;
    console.log('[PumpfunHeliusFallback] start failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
