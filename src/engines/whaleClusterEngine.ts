import { sendTelegram } from '../services/telegram.js';
import { config } from '../config.js';
import { addAlphaSignal } from './alphaFeed.js';

type WhaleHit = {
  wallet: string;
  token: string;
  symbol: string;
  usdSize: number;
  timestamp: number;
};

const recentHits: WhaleHit[] = [];
const alertedClusters = new Set<string>();

const CLUSTER_WINDOW_MIN = 20;
const MIN_UNIQUE_WALLETS = 2;

function cutoffMs() {
  return Date.now() - CLUSTER_WINDOW_MIN * 60_000;
}

function prune() {
  while (recentHits.length && recentHits[0].timestamp < cutoffMs()) {
    recentHits.shift();
  }
}

export function recordWhaleHit(hit: WhaleHit) {
  if (!hit.token) return;

  recentHits.push(hit);
  prune();
}

function groupClusters() {
  const map = new Map<string, WhaleHit[]>();

  for (const hit of recentHits) {
    if (!map.has(hit.token)) {
      map.set(hit.token, []);
    }

    map.get(hit.token)!.push(hit);
  }

  return [...map.entries()];
}

export async function runWhaleClusterEngine() {
  prune();

  for (const [token, hits] of groupClusters()) {
    const wallets = [...new Set(hits.map((x) => x.wallet))];

    if (wallets.length < MIN_UNIQUE_WALLETS) {
      continue;
    }

    const clusterKey = `${token}-${wallets.sort().join('-')}`;

    if (alertedClusters.has(clusterKey)) {
      continue;
    }

    alertedClusters.add(clusterKey);

    const totalUsd = hits.reduce((sum, h) => sum + h.usdSize, 0);
    const symbol = hits[0]?.symbol || 'Unknown';

    const dexUrl = `https://dexscreener.com/solana/${token}`;
    const buyUrl = `https://jup.ag/swap/SOL-${token}`;

    addAlphaSignal({
      type: 'WHALE_CLUSTER',
      title: '🐋🐋 Whale Cluster Alert',
      symbol,
      token,
      score: wallets.length >= 3 ? 90 : 75,
      conviction: wallets.length >= 3 ? 'WHALE GRADE' : 'STRONG',
      summary: `${wallets.length} wallets • Est. cluster $${Math.round(totalUsd).toLocaleString()} • ${CLUSTER_WINDOW_MIN}m window`,
      dexUrl,
      buyUrl,
    });

    await sendTelegram(
      config.ownerChatId,
      [
        '🐋🐋 <b>WHALE CLUSTER ALERT</b>',
        '',
        `<b>${symbol}</b>`,
        `Whales Detected: <b>${wallets.length}</b>`,
        `Cluster Size: <b>$${Math.round(totalUsd).toLocaleString()}</b>`,
        `Window: <b>${CLUSTER_WINDOW_MIN}m</b>`,
        '',
        'Multiple tracked whales entered same token.',
        'Potential smart-money accumulation.',
      ].join('\n'),
      [
        [
          {
            text: '🟢 Buy',
            url: buyUrl,
          },
          {
            text: '📈 Chart',
            url: dexUrl,
          },
        ],
      ]
    );
  }
}