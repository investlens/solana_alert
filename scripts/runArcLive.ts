import 'dotenv/config';
import { verifyArcMainnet, getArcBlockNumber } from '../src/chains/arc/rpc.js';
import { discoverArcV4Pools } from '../src/chains/arc/uniswap.js';
import { normalizeArcPoolCandidate } from '../src/chains/arc/candidate.js';
import { enrichArcCandidate } from '../src/chains/arc/enrichment.js';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { assessArcForAlert } from '../src/chains/arc/alertGate.js';
import { sendTelegramWithMessageId } from '../src/services/telegram.js';

const POLL_MS = Math.max(2_000, Number(process.env.ARC_LIVE_POLL_INTERVAL_MS ?? 5_000));
const ENABLED = String(process.env.ARC_LIVE_ENABLED ?? 'false').toLowerCase() === 'true';
const MAX_BLOCKS = Math.max(1, Number(process.env.ARC_LIVE_MAX_BLOCKS_PER_POLL ?? 250));
const ALERT_CHAT_ID = String(process.env.ADMIN_TELEGRAM_ID || process.env.OWNER_CHAT_ID || '').trim();
const delivered = new Set<string>();

function formatUsd(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `$${Math.round(value).toLocaleString('en-US')}`;
}

async function deliverArcAlert(market: Awaited<ReturnType<typeof enrichArcMarket>>, warnings: string[]) {
  const key = market.assetId.toLowerCase();
  if (!ALERT_CHAT_ID || delivered.has(key)) return;

  const symbol = market.symbol || 'ARC TOKEN';
  const buys = market.buys5m ?? 0;
  const sells = market.sells5m ?? 0;
  const ratio = sells > 0 ? (buys / sells).toFixed(2) : buys > 0 ? '∞' : 'n/a';
  const text = [
    '🟣 <b>AlphaOS ARC Opportunity</b>',
    '',
    `<b>${symbol}</b>`,
    `<code>${market.assetId}</code>`,
    '',
    `Liquidity: <b>${formatUsd(market.liquidityUsd)}</b>`,
    `5m Volume: <b>${formatUsd(market.volume5mUsd)}</b>`,
    `Buys / Sells: <b>${buys} / ${sells}</b> (${ratio}x)`,
    `Market Cap: <b>${formatUsd(market.marketCapUsd)}</b>`,
    warnings.length ? `Safety notes: ${warnings.join(', ')}` : 'Safety: core checks passed',
  ].join('\n');

  const messageId = await sendTelegramWithMessageId(ALERT_CHAT_ID, text);
  delivered.add(key);
  console.log('[ArcLive] ALERT_SENT', { assetId: market.assetId, symbol: market.symbol, messageId });
}

async function main() {
  console.log('[ArcLive] starting', { enabled: ENABLED, pollIntervalMs: POLL_MS, mode: 'LIVE_ALERTS', hasAlertRecipient: Boolean(ALERT_CHAT_ID) });
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
        warnings: assessment.security.warnings,
      });

      if (assessment.alertable) {
        await deliverArcAlert(market, assessment.security.warnings).catch(error => {
          console.error('[ArcLive] ALERT_SEND_FAILED', { assetId: market.assetId, error });
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
