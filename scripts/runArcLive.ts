import 'dotenv/config';
import { verifyArcMainnet, getArcBlockNumber } from '../src/chains/arc/rpc.js';
import { discoverArcV4Pools } from '../src/chains/arc/uniswap.js';
import { normalizeArcPoolCandidate } from '../src/chains/arc/candidate.js';
import { enrichArcCandidate } from '../src/chains/arc/enrichment.js';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { assessArcForAlert } from '../src/chains/arc/alertGate.js';

const POLL_MS = Math.max(2_000, Number(process.env.ARC_LIVE_POLL_INTERVAL_MS ?? 5_000));
const ENABLED = String(process.env.ARC_LIVE_ENABLED ?? 'false').toLowerCase() === 'true';
const WATCH_ALERTS_ENABLED = String(process.env.ARC_WATCH_ALERTS_ENABLED ?? 'false').toLowerCase() === 'true';
const MAX_BLOCKS = Math.max(1, Number(process.env.ARC_LIVE_MAX_BLOCKS_PER_POLL ?? 250));
const WATCH_DEDUPE_MS = Math.max(60_000, Number(process.env.ARC_WATCH_DEDUPE_MS ?? 6 * 60 * 60 * 1000));

const watchClaims = new Map<string, number>();

function html(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function compactUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'unavailable';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function claimWatch(key: string, now = Date.now()): boolean {
  for (const [existing, claimedAt] of watchClaims) {
    if (now - claimedAt > WATCH_DEDUPE_MS) watchClaims.delete(existing);
  }
  if (watchClaims.has(key)) return false;
  watchClaims.set(key, now);
  return true;
}

async function sendAdminWatch(args: {
  assetId: string;
  name: string | null;
  symbol: string | null;
  poolId: string;
  transactionHash: string;
  liquidityUsd: number | null;
  volume5mUsd: number | null;
  buys5m: number | null;
  marketCapUsd: number | null;
  blockedBy: string[];
}): Promise<void> {
  if (!WATCH_ALERTS_ENABLED) return;

  const ownerChatId = String(process.env.OWNER_CHAT_ID ?? process.env.ADMIN_TELEGRAM_ID ?? '').trim();
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!ownerChatId || !botToken) {
    console.warn('[ArcLive] ARC WATCH suppressed: Telegram credentials are not configured on arc-live.');
    return;
  }

  const key = `${args.assetId.toLowerCase()}:${args.poolId.toLowerCase()}`;
  if (!claimWatch(key)) return;

  const { sendTelegram } = await import('../src/services/telegram.js');
  const label = args.symbol || args.name || 'Unknown ARC token';
  const message = [
    '🟣 <b>ARC WATCH — NEW LAUNCH</b>',
    '',
    `<b>${html(label)}</b>${args.name && args.symbol ? ` — ${html(args.name)}` : ''}`,
    `<code>${html(args.assetId)}</code>`,
    '',
    `Liquidity: <b>${html(compactUsd(args.liquidityUsd))}</b>`,
    `5m volume: <b>${html(compactUsd(args.volume5mUsd))}</b>`,
    `5m buys: <b>${html(args.buys5m ?? 'unavailable')}</b>`,
    `Market cap: <b>${html(compactUsd(args.marketCapUsd))}</b>`,
    '',
    '⚠️ <b>WATCH ONLY — NOT A BUY ALERT</b>',
    'AlphaOS detected the ARC launch, but full security verification is incomplete.',
    `Security pending: ${html(args.blockedBy.slice(0, 6).join(', ') || 'unknown')}`,
    '',
    `Pool: <code>${html(args.poolId)}</code>`,
    `Tx: <code>${html(args.transactionHash)}</code>`,
  ].join('\n');

  try {
    await sendTelegram(ownerChatId, message);
    console.log('[ArcLive] ARC_WATCH_SENT', { assetId: args.assetId, poolId: args.poolId, telegramDelivered: true });
  } catch (error) {
    watchClaims.delete(key);
    console.error('[ArcLive] ARC_WATCH_SEND_FAILED', {
      assetId: args.assetId,
      poolId: args.poolId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main() {
  console.log('[ArcLive] starting', {
    enabled: ENABLED,
    pollIntervalMs: POLL_MS,
    mode: WATCH_ALERTS_ENABLED ? 'ADMIN_WATCH_SECURITY_FAIL_CLOSED' : 'OBSERVE_ONLY_NO_ALERTS',
    watchAlertsEnabled: WATCH_ALERTS_ENABLED,
  });
  const verified = await verifyArcMainnet();
  console.log('[ArcLive] mainnet verified', { chainId: verified.chainId, blockNumber: verified.blockNumber.toString() });

  if (!ENABLED) {
    console.log('[ArcLive] observer disabled; set ARC_LIVE_ENABLED=true on an isolated service after validation.');
    return;
  }

  let last = verified.blockNumber;
  while (true) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    const current = await getArcBlockNumber();
    if (current <= last) continue;

    const fromBlock = last + 1n;
    const cappedTo = fromBlock + BigInt(MAX_BLOCKS - 1);
    const toBlock = current < cappedTo ? current : cappedTo;
    const pools = await discoverArcV4Pools(fromBlock, toBlock);
    const candidates = pools.map(normalizeArcPoolCandidate).filter((x): x is NonNullable<typeof x> => Boolean(x));

    console.log('[ArcLive] scan', { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), poolsDetected: pools.length, launchCandidates: candidates.length });

    for (const candidate of candidates) {
      const enriched = await enrichArcCandidate(candidate);
      const market = await enrichArcMarket(enriched);
      const assessment = assessArcForAlert(market);
      console.log('[ArcLive] SECURITY_ASSESSMENT', {
        assetId: market.assetId,
        symbol: market.symbol,
        liquidityUsd: market.liquidityUsd,
        volume5mUsd: market.volume5mUsd,
        buys5m: market.buys5m,
        sells5m: market.sells5m,
        marketCapUsd: market.marketCapUsd,
        alertable: assessment.alertable,
        status: assessment.status,
        blockedBy: assessment.security.reasons,
      });

      // Watch notifications intentionally require valid on-chain ERC-20 metadata/code,
      // but do NOT promote the candidate to BUY/HIGH_BUY. The production security
      // gate remains fail-closed until all ARC security collectors are verified.
      if (enriched.contractCodePresent && enriched.metadataReadable) {
        await sendAdminWatch({
          assetId: market.assetId,
          name: market.name,
          symbol: market.symbol,
          poolId: market.poolId,
          transactionHash: market.transactionHash,
          liquidityUsd: market.liquidityUsd,
          volume5mUsd: market.volume5mUsd,
          buys5m: market.buys5m,
          marketCapUsd: market.marketCapUsd,
          blockedBy: assessment.security.reasons,
        });
      }
    }

    last = toBlock;
  }
}

main().catch(error => {
  console.error('[ArcLive] fatal', error);
  process.exitCode = 1;
});
