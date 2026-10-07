import { recordFeedDelivery } from '../src/services/feedDeliveryHealth.js';
import { recordRejectedCandidate, runRejectedCandidateReview } from '../src/services/rejectedCandidateReview.js';
import { withAlertKeyStats, type AlertKeyStats } from '../src/ui/alertKeyStats.js';
import { readResearchTokenSupply, formatResearchSupply } from '../src/services/researchTokenSupply.js';
import { createArcDexPaidWatch } from '../src/chains/arc/dexPaidWatch.js';
import { consistentArcVolume5m, fetchArcBoostFeed } from '../src/chains/arc/boostFeed.js';
import { governedDexScreenerJson } from '../src/services/dexscreenerRequestGovernor.js';
import { withOwnershipDisclosure } from '../src/ui/ownershipDisclosure.js';
import { enabledLiveRecipients, type LiveFeedKey } from '../src/services/liveAlertPreferences.js';
import { arcMarketNumber } from '../src/chains/arc/market.js';
import { waitForRecipientDelivery, recordDeliveryAccepted } from '../src/services/recipientDeliveryTiming.js';
import { recordCompactAlert } from '../src/services/compactAlertOutcomes.js';
import { arcBoostSafetyFromEvidence, processArcBoostObservation } from '../src/chains/arc/boostSafety.js';
import {arcDeliverySafety,isArcPromotionFeed,ARC_PROMOTION_WARNING} from '../src/chains/arc/promotionPolicy.js';
import 'dotenv/config';
import { verifyArcMainnet, getArcBlockNumber, getArcLogs, readArcContract } from '../src/chains/arc/rpc.js';
import { discoverArcV4Pools } from '../src/chains/arc/uniswap.js';
import { normalizeArcPoolCandidate } from '../src/chains/arc/candidate.js';
import { enrichArcCandidate, canRetryArcEnrichment } from '../src/chains/arc/enrichment.js';
import { enrichArcMarket } from '../src/chains/arc/market.js';
import { assessArcForAlert } from '../src/chains/arc/alertGate.js';
import { sendTelegramWithMessageId } from '../src/services/telegram.js';
import { getDeliverableUsers } from '../src/core/delivery.js';
import { supabase } from '../src/services/supabase.js';
import { decodeEventLog, formatUnits, parseAbiItem } from 'viem';

const POLL_MS = Math.max(2_000, Number(process.env.ARC_LIVE_POLL_INTERVAL_MS ?? 5_000));
const ENABLED = String(process.env.ARC_LIVE_ENABLED ?? 'false').toLowerCase() === 'true';
const MAX_BLOCKS = Math.max(1, Number(process.env.ARC_LIVE_MAX_BLOCKS_PER_POLL ?? 250));
const ALERT_CHAT_ID = String(process.env.ADMIN_TELEGRAM_ID || process.env.OWNER_CHAT_ID || '').trim();
const RECIPIENT_CACHE_MS = Math.max(60_000, Number(process.env.ARC_RECIPIENT_CACHE_MS ?? 300_000));
let recipientCacheAt = 0;
let recipientCache = new Set<string>();
const delivered = new Set<string>();
const MARKET_RETRY_DELAY_MS = Math.max(12_000, Number(process.env.ARC_MARKET_RETRY_DELAY_MS ?? 15_000));
const ARC_MIN_NORMAL_ALERT_AGE_MS = Math.max(5 * 60_000, Number(process.env.ARC_MIN_NORMAL_ALERT_AGE_MS ?? 30 * 60_000));
const ARC_REVERSAL_CONFIRM_MS = Math.max(15_000, Number(process.env.ARC_REVERSAL_CONFIRM_MS ?? 30_000));
const MARKET_RETRY_MAX_PENDING = Math.max(5, Math.min(50, Number(process.env.ARC_MARKET_RETRY_MAX_PENDING ?? 20)));
const MARKET_RETRY_PER_POLL = Math.max(1, Math.min(5, Number(process.env.ARC_MARKET_RETRY_PER_POLL ?? 3)));
type PendingArcRetry = {
  enriched: Awaited<ReturnType<typeof enrichArcCandidate>>;
  retryAt: number;
  firstSeenAt: number;
  baselinePrice?: number | null;
};
const pendingMarketRetries = new Map<string, PendingArcRetry>();
const arcBoostTotals = new Map<string, number>();
const arcBoostDelivered = new Set<string>();
let arcBoostBaselineReady = false;
const ARC_BOOST_RECOVERY_MAX = Math.max(1, Math.min(20, Number(process.env.ARC_BOOST_RECOVERY_MAX ?? 12)));
const ARC_BOOST_POLL_MS = Math.max(10_000, Number(process.env.ARC_BOOST_POLL_MS ?? 15_000));
let lastArcBoostPollAt = 0;

const ARC_BURN_MIN_PERCENT = Math.max(0.01, Number(process.env.ARC_BURN_MIN_PERCENT ?? 0.5));
const ERC20_TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const ERC20_SUPPLY_ABI = [
  { type:'function', name:'totalSupply', stateMutability:'view', inputs:[], outputs:[{type:'uint256'}] },
  { type:'function', name:'decimals', stateMutability:'view', inputs:[], outputs:[{type:'uint8'}] },
  { type:'function', name:'symbol', stateMutability:'view', inputs:[], outputs:[{type:'string'}] },
] as const;
const BURN_ADDRESSES = new Set(['0x0000000000000000000000000000000000000000','0x000000000000000000000000000000000000dead']);
const burnDelivered = new Set<string>();


async function verifyArcBurnAlertLpSafety(token: string, chainId: string): Promise<{ verified:boolean; protectedPercent:number; reason:string }> {
  try {
    const response = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(token.toLowerCase())}`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { verified:false, protectedPercent:0, reason:`goplus_http_${response.status}` };
    const body = await response.json() as any;
    const info = body?.result?.[token.toLowerCase()];
    if (!info || String(info.is_in_dex ?? '') !== '1' || !Array.isArray(info.lp_holders) || !info.lp_holders.length) return { verified:false, protectedPercent:0, reason:'lp_evidence_unavailable' };
    const protectedPercent = info.lp_holders.reduce((sum:number, holder:any) => {
      const address = String(holder?.address ?? '').toLowerCase();
      const tag = String(holder?.tag ?? '').toLowerCase();
      const protectedLp = String(holder?.is_locked ?? '') === '1'
        || address === '0x0000000000000000000000000000000000000000'
        || address === '0x000000000000000000000000000000000000dead'
        || /burn|dead|blackhole/.test(tag);
      const pct = Number(holder?.percent ?? 0);
      return sum + (protectedLp && Number.isFinite(pct) && pct > 0 ? pct : 0);
    }, 0);
    return { verified: protectedPercent >= 0.90, protectedPercent, reason: protectedPercent >= 0.90 ? 'locked_or_burned' : 'insufficient_lp_protection' };
  } catch { return { verified:false, protectedPercent:0, reason:'lp_verification_failed' }; }
}

async function processArcBurns(fromBlock: bigint, toBlock: bigint): Promise<void> {
  const logs = await getArcLogs({ fromBlock, toBlock, event: ERC20_TRANSFER_EVENT, args: { to: [...BURN_ADDRESSES] } }).catch(error => {
    console.warn('[ArcBurn] LOG_SCAN_FAILED', { reason: error instanceof Error ? error.message : String(error) });
    return [];
  });
  for (const log of logs) {
    try {
      const token = String(log.address ?? '').toLowerCase();
      const txHash = String(log.transactionHash ?? '');
      const identity = `${txHash}:${Number(log.logIndex ?? 0)}`;
      if (!token || burnDelivered.has(identity)) continue;
      // A standard ERC-20 Transfer has two indexed address topics plus a
      // 32-byte non-indexed value. Some ARC contracts emit Transfer-like logs
      // with no data; they cannot prove a burn amount and should be ignored
      // before viem decoding rather than generating repeated decoder errors.
      if (!log.data || String(log.data).toLowerCase() === '0x' || String(log.data).length < 66) {
        console.info('[ArcBurn] MALFORMED_TRANSFER_SUPPRESSED', {
          token,
          txHash,
          dataBytes: Math.max(0, (String(log.data ?? '0x').length - 2) / 2),
        });
        burnDelivered.add(identity);
        continue;
      }
      const decoded = decodeEventLog({ abi:[ERC20_TRANSFER_EVENT], data:log.data, topics:log.topics });
      const args = decoded.args as { from?: string; to?: string; value?: bigint };
      if (!args.to || !BURN_ADDRESSES.has(args.to.toLowerCase()) || !args.value || args.value <= 0n) continue;
      const [totalSupplyRaw, decimalsRaw, symbolRaw] = await Promise.all([
        readArcContract({ address:token, abi:ERC20_SUPPLY_ABI, functionName:'totalSupply' }),
        readArcContract({ address:token, abi:ERC20_SUPPLY_ABI, functionName:'decimals' }).catch(()=>18),
        readArcContract({ address:token, abi:ERC20_SUPPLY_ABI, functionName:'symbol' }).catch(()=>'ARC TOKEN'),
      ]);
      // totalSupply() is read AFTER the burn transaction. For a true ERC-20 burn
      // the pre-burn supply is current supply + burned amount. Using post-burn
      // supply as the denominator can falsely report >100% burns.
      const postBurnSupply = BigInt(totalSupplyRaw as any);
      if (postBurnSupply < 0n) continue;
      const destination = String(args.to).toLowerCase();
      const isProtocolBurn = destination === '0x0000000000000000000000000000000000000000';
      // Only a protocol burn to address(0) proves totalSupply was reduced.
      // A transfer to 0xdead is irreversible-looking but does not itself prove
      // ERC-20 totalSupply changed, so fail closed and do not alert it here.
      if (!isProtocolBurn) {
        console.info('[ArcBurn] UNVERIFIED_BURN_SUPPRESSED', { token, txHash, destination });
        continue;
      }
      const preBurnSupply = postBurnSupply + args.value;
      if (preBurnSupply <= 0n || postBurnSupply >= preBurnSupply) continue;
      const burnPercent = Number((args.value * 1_000_000n) / preBurnSupply) / 10_000;
      // Fail closed on impossible/corrupt calculations; never show >100%.
      if (!Number.isFinite(burnPercent) || burnPercent <= 0 || burnPercent > 100) {
        console.warn('[ArcBurn] INVALID_BURN_PERCENT_SUPPRESSED', { token, txHash, burnPercent });
        continue;
      }
      if (burnPercent < ARC_BURN_MIN_PERCENT) continue;
      const decimals = Number(decimalsRaw ?? 18);
      const symbol = String(symbolRaw || 'ARC TOKEN').slice(0,32);
      const burned = formatUnits(args.value, decimals);
      const from = String(args.from ?? '').toLowerCase();
      // Locked AlphaOS Burn card: keep detection lean; enrich only after >= threshold qualifies.
      let marketCap: number | null = null; let fdv: number | null = null;
      let outcomePrice: number | null = null; let outcomePair: string | null = null;
      let liquidity: number | null = null;
      let dexUrl: string | null = null;
      let website: string | null = null;
      let twitter: string | null = null;
      let telegram: string | null = null;
      try {
        const response = await fetch(`https://api.dexscreener.com/token-pairs/v1/arc/${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(3_000) });
        if (response.ok) {
          const pairs = await response.json() as any[];
          const pair = Array.isArray(pairs) ? pairs.find(p => p?.chainId === 'arc' && String(p?.baseToken?.address ?? '').toLowerCase() === token.toLowerCase()) : null;
          outcomePrice = Number(pair?.priceUsd) || null; outcomePair = pair?.pairAddress ?? null;
          marketCap = arcMarketNumber(pair?.marketCap); fdv = arcMarketNumber(pair?.fdv);
          liquidity = Number.isFinite(Number(pair?.liquidity?.usd)) ? Number(pair.liquidity.usd) : null;
          dexUrl = pair?.url ? String(pair.url) : null;
          website = Array.isArray(pair?.info?.websites) ? pair.info.websites.find((x:any)=>x?.url)?.url ?? null : null;
          const socials = Array.isArray(pair?.info?.socials) ? pair.info.socials : [];
          twitter = socials.find((x:any)=>String(x?.type).toLowerCase()==='twitter')?.url ?? null;
          telegram = socials.find((x:any)=>String(x?.type).toLowerCase()==='telegram')?.url ?? null;
        }
      } catch {}
      // Burn alerts are actionable only once the token has a real DEX market.
      // Fail closed: no indexed DEX pair or no positive liquidity = no alert.
      if (!dexUrl || liquidity == null || !Number.isFinite(liquidity) || liquidity < 2_000) {
        console.info('[ArcBurn] DEX_LIQUIDITY_BELOW_MIN_SUPPRESSED', { token, txHash, burnPercent, liquidity });
        continue;
      }
      const lpSafety = await verifyArcBurnAlertLpSafety(token, '5042');
      if (!lpSafety.verified) {
        console.info('[ArcBurn] UNVERIFIED_LP_SAFETY_SUPPRESSED', { token, txHash, burnPercent, liquidity, reason:lpSafety.reason, protectedPercent:lpSafety.protectedPercent });
        continue;
      }
      const shortCa = `${token.slice(0,8)}…${token.slice(-6)}`;
      const text = [
        '🔥 <b>AlphaOS · ARC SUPPLY BURN</b>', '━━━━━━━━━━━━━━━━━━',
        `🔥 <b>${symbol}</b>  ·  <code>${shortCa}</code>`, `<code>${token}</code>`,'',
        '🔥 <b>SUPPLY BURN</b>',
        `Burned        <b>${burnPercent.toFixed(2)}% of total supply</b>`,
        `Amount        <b>${burned} ${symbol}</b>`,'',
        '🔥 <b>BURN DESTINATION</b>',
        `Burn Address  <code>${String(args.to).slice(0,10)}…${String(args.to).slice(-6)}</code>`,
        `Source Wallet <code>${from.slice(0,8)}…${from.slice(-6)}</code>`,'',
        '📊 <b>MARKET</b>',
        ...(marketCap != null ? [`Market Cap    <b>${formatUsd(marketCap)}</b>`] : fdv != null ? [`FDV    <b>${formatUsd(fdv)}</b>`] : []),
        `Liquidity     <b>${formatUsd(liquidity)}</b>`,'',
        '🛡️ <b>Verified supply reduction · on-chain</b>','',
        '⚠️ <b>Supply burn is not a guarantee of price appreciation.</b>','',
        '<i>AlphaOS · Find. Analyse. Trade Smarter.</i>',
      ].join('\n');
      const buttons = [
        [ ...(dexUrl ? [{ text:'📈 Chart', url:dexUrl }] : []), { text:'🔥 Burn Tx', url:`https://explorer.arc.io/tx/${encodeURIComponent(txHash)}` } ],
        [ { text:'🔎 Explorer', url:`https://explorer.arc.io/address/${encodeURIComponent(token)}` }, ...(website ? [{text:'🌐 Project',url:website}] : []) ],
        [ ...(twitter ? [{text:'𝕏 X',url:twitter}] : []), ...(telegram ? [{text:'✈️ TG',url:telegram}] : []) ],
      ].filter(row => row.length > 0);
      const delivery = await broadcastArcAlert(text, buttons, token, 'ARC_SUPPLY_BURN');
      burnDelivered.add(identity);
      console.log('[ArcBurn] ALERT_SENT', { token, symbol, burnPercent, txHash, delivered:delivery.delivered });
    } catch (error) {
      console.warn('[ArcBurn] EVENT_SKIPPED', { reason:error instanceof Error ? error.message : String(error) });
    }
  }
}

async function getArcRecipients(): Promise<string[]> {
  const now = Date.now();
  if (recipientCache.size && now - recipientCacheAt < RECIPIENT_CACHE_MS) return [...recipientCache];
  const next = new Set<string>();
  if (ALERT_CHAT_ID) next.add(ALERT_CHAT_ID);
  try {
    const users = await getDeliverableUsers();
    for (const user of users) {
      const telegramId = String(user.telegram_id ?? '').trim();
      if (telegramId && !user.is_blocked) next.add(telegramId);
    }
    if (next.size) {
      recipientCache = next;
      recipientCacheAt = now;
    }
  } catch (error) {
    console.warn('[ArcLive] recipient refresh failed; using cached/admin recipients', {
      cached: recipientCache.size,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!recipientCache.size && ALERT_CHAT_ID) recipientCache.add(ALERT_CHAT_ID);
  return [...recipientCache];
}

async function broadcastArcAlert(text: string, buttons: any[][], outcomeToken?: string, feed:LiveFeedKey = 'ARC_OPPORTUNITY', expectedPool?:string): Promise<{delivered:number;failed:number;adminMessageId:number|null}> {
  // Boost/payment are event-only; normal opportunity and burn retain their gate.
  if (!outcomeToken) throw new Error('ARC alert lacks token identity for sellability check');
  const sellSafety = await arcDeliverySafety(feed,outcomeToken,checkArcBoostSecurity);
  const cachedOwnership = isArcPromotionFeed(feed) ? arcSellSafetyCache.get(outcomeToken.toLowerCase()) : null;
  if(cachedOwnership && Date.now()-cachedOwnership.at < 90_000) {
    sellSafety.creator=cachedOwnership.result.creator;
    sellSafety.devHoldingPercent=cachedOwnership.result.devHoldingPercent;
    sellSafety.top10Percent=cachedOwnership.result.top10Percent;
    sellSafety.observedAt=cachedOwnership.result.observedAt;
  }
  if (!sellSafety.allowed) throw new Error(`ARC sellability blocked: ${sellSafety.reason}`);
  const stats = await arcAlertStats(outcomeToken,expectedPool);
  if (feed==='ARC_DEX_PAID') text = text.replace('Promotion payment confirmed',`${String(stats.name??'Token name unavailable').replace(/[<>&]/g,'')} (${String(stats.symbol??'Symbol unavailable').replace(/[<>&]/g,'')})\nPromotion payment confirmed`);
  if(isArcPromotionFeed(feed)) text += `\n⚠️ <b>${sellSafety.reason}</b>`;
  text = withAlertKeyStats(text,{...stats,sellability:isArcPromotionFeed(feed)?(sellSafety.sellabilityVerified?'No provider sell-restriction flag · execution unverified':'Unverified · manual validation required'):'Provider flags passed · execution unverified',lp:isArcPromotionFeed(feed)?'Not checked':'Unverified',dexPaid:feed==='ARC_DEX_PAID'?'Yes · payment confirmed':undefined});
  text = withOwnershipDisclosure(text, {creator:sellSafety.creator,creatorExplorer:"https://explorer.arc.io/address/",devPercent: sellSafety.devHoldingPercent ?? null, devObservedAt:sellSafety.observedAt,top10ObservedAt:sellSafety.observedAt,
    top10Percent: sellSafety.top10Percent ?? null, top10Coverage: sellSafety.top10Percent == null ? 'UNAVAILABLE' : 'PROVIDER_REPORTED'});
  if (outcomeToken && /^0x[a-fA-F0-9]{40}$/.test(outcomeToken)) buttons = [...buttons, [{text:'⭐ Track',callback_data:`OUT_ARC_${outcomeToken}`}]];
  const recipients = await enabledLiveRecipients(await getArcRecipients(), feed);
  if (!recipients.length) return {delivered:0,failed:0,adminMessageId:null};
  const deliveryStartedAt = Date.now();
  const results = await Promise.allSettled(recipients.map(async chatId => {
    await waitForRecipientDelivery(chatId, deliveryStartedAt);
    const accepted = await sendTelegramWithMessageId(chatId, text, buttons);
    recordDeliveryAccepted(chatId, deliveryStartedAt, `arc:${outcomeToken ?? 'discovery'}`);
    return accepted;
  }));
  let deliveredCount = 0;
  let failed = 0;
  let adminMessageId: number | null = null;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      deliveredCount += 1;
      if (recipients[index] === ALERT_CHAT_ID) adminMessageId = result.value;
    } else {
      failed += 1;
      console.warn('[ArcLive] RECIPIENT_PROCESSING_FAILED', { recipient: recipients[index], reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
  });
  recordFeedDelivery(feed,'ACCEPTED',deliveredCount); recordFeedDelivery(feed,'PROCESSING_FAILED',failed);
  if (!deliveredCount) throw new Error(`ARC Telegram delivery failed for all ${failed} recipients`);
  void recordCompactAlert({chain:'arc', token:outcomeToken, feed, price:stats.price, marketCap:stats.marketCap, liquidity:stats.liquidity, pair:stats.pairAddress}, deliveredCount);
  return { delivered: deliveredCount, failed, adminMessageId };
}

function formatUsd(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'n/a' : `$${Math.round(value).toLocaleString('en-US')}`;
}

async function deliverArcAlert(market: Awaited<ReturnType<typeof enrichArcMarket>>, warnings: string[]) {
  const key = market.assetId.toLowerCase();
  if (delivered.has(key)) {
    console.log('[ArcLive] DUPLICATE_OPPORTUNITY_SUPPRESSED', { assetId: market.assetId, reason: 'already delivered this runtime' });
    return;
  }

  const symbol = market.symbol || 'ARC TOKEN';
  const buys = market.buys5m ?? 0;
  const sells = market.sells5m;
  const ratio = sells != null && sells > 0 ? (buys / sells).toFixed(2) : sells === 0 && buys > 0 ? '∞' : 'n/a';
  const shortCa = market.assetId.length > 14
    ? `${market.assetId.slice(0, 8)}…${market.assetId.slice(-6)}`
    : market.assetId;
  const unavailable = warnings
    .filter(item => /UNKNOWN/i.test(item))
    .map(item => item.replace(/_UNKNOWN$/i, '').replace(/_/g, ' ').toLowerCase())
    .map(item => item.replace(/\b\w/g, char => char.toUpperCase()));
  const otherWarnings = warnings.filter(item => !/UNKNOWN/i.test(item));
  const ratioNumber = sells != null && sells > 0 ? buys / sells : sells === 0 && buys > 0 ? 99 : 0;
  const evidence = [
    ratioNumber >= 1.5 ? `🟢 Strong <b>${ratio}x</b> buy pressure` : null,
    (market.volume5mUsd ?? 0) > 0 ? `📊 <b>${formatUsd(market.volume5mUsd)}</b> activity in 5m` : null,
    (market.liquidityUsd ?? 0) > 0 ? `💧 <b>${formatUsd(market.liquidityUsd)}</b> liquidity` : null,
  ].filter(Boolean);

  const text = [
    '🟣 <b>AlphaOS · ARC OPPORTUNITY</b>',
    '━━━━━━━━━━━━━━━━━━',
    `🚀 <b>${symbol}</b>  ·  <code>${shortCa}</code>`,
    `<code>${market.assetId}</code>`,
    '',
    `💧 Liquidity     <b>${formatUsd(market.liquidityUsd)}</b>`,
    `📊 5m Volume     <b>${formatUsd(market.volume5mUsd)}</b>`,
    `🟢 Buys / Sells  <b>${buys} / ${sells ?? 'Unavailable'}</b>  ·  <b>${ratio}x</b>`,
    ...(market.marketCapUsd != null ? [`💰 Market Cap    <b>${formatUsd(market.marketCapUsd)}</b>`]
      : market.fdvUsd != null ? [`💰 FDV    <b>${formatUsd(market.fdvUsd)}</b>`] : []),
    '',
    '🎯 <b>WHY ALPHAOS FLAGGED IT</b>',
    ...(evidence.length ? evidence : ['• Market opportunity criteria passed']),
    '',
    '🛡️ <b>SAFETY</b>',
    '✅ Core ARC contract checks passed',
    ...(otherWarnings.length ? otherWarnings.map(item => `⚠️ ${item.replace(/_/g, ' ')}`) : []),
    ...(unavailable.length ? [`⚪ Additional checks unavailable: ${unavailable.join(', ')}`] : []),
    '',
    '⚠️ <b>Do your own diligence.</b>', '', '<i>AlphaOS · Find. Analyse. Trade Smarter.</i>',
  ].join('\n');

  // Keep the alert action-first: chart + explorer are core; project/social
  // links appear only when the same market payload already supplied them.
  const buttons = [
    [
      ...(market.dexUrl ? [{ text: '📈 Chart', url: market.dexUrl }] : []),
      { text: '🔎 Explorer', url: `https://explorer.arc.io/address/${encodeURIComponent(market.assetId)}` },
    ],
    [
      ...(market.projectWebsite ? [{ text: '🌐 Project', url: market.projectWebsite }] : []),
      ...(market.projectTwitter ? [{ text: '𝕏', url: market.projectTwitter }] : []),
      ...(market.projectTelegram ? [{ text: '✈️ TG', url: market.projectTelegram }] : []),
    ],
  ].filter(row => row.length > 0);

  const delivery = await broadcastArcAlert(text, buttons, market.assetId, 'ARC_OPPORTUNITY', market.poolId);
  delivered.add(key);
  console.log('[ArcLive] ALERT_SENT', { assetId: market.assetId, symbol: market.symbol, messageId: delivery.adminMessageId, delivered: delivery.delivered, failed: delivery.failed });
}


function canRetryMarket(enriched: Awaited<ReturnType<typeof enrichArcCandidate>>): boolean {
  return canRetryArcEnrichment(enriched);
}

function queueMarketRetry(enriched: Awaited<ReturnType<typeof enrichArcCandidate>>): void {
  const key = enriched.assetId.toLowerCase();
  if (!canRetryMarket(enriched) || pendingMarketRetries.has(key) || delivered.has(key)) return;
  if (pendingMarketRetries.size >= MARKET_RETRY_MAX_PENDING) {
    const oldest = pendingMarketRetries.keys().next().value;
    if (oldest) pendingMarketRetries.delete(oldest);
  }
  pendingMarketRetries.set(key, {
    enriched,
    retryAt: Date.now() + MARKET_RETRY_DELAY_MS,
    firstSeenAt: Date.now(),
  });
  console.log('[ArcLive] MARKET_RETRY_QUEUED', {
    assetId: enriched.assetId,
    symbol: enriched.symbol,
    retryInMs: MARKET_RETRY_DELAY_MS,
    pending: pendingMarketRetries.size,
  });
}

async function processMarketRetries(): Promise<void> {
  let processed = 0;
  const now = Date.now();
  for (const [key, pending] of pendingMarketRetries) {
    if (now - pending.firstSeenAt > 60 * 60_000) { pendingMarketRetries.delete(key); continue; }
    if (processed >= MARKET_RETRY_PER_POLL) break;
    if (pending.retryAt > now) continue;
    pendingMarketRetries.delete(key);
    processed += 1;

    if (!pending.enriched.metadataReadable || !pending.enriched.contractCodePresent) {
      pending.enriched = await enrichArcCandidate(pending.enriched);
      if (!pending.enriched.eligibleForScoring) {
        if (canRetryMarket(pending.enriched)) pendingMarketRetries.set(key, { ...pending, retryAt: Date.now() + MARKET_RETRY_DELAY_MS });
        continue;
      }
    }

    const market = await enrichArcMarket(pending.enriched);
    if (market.marketDataSource == null) {
      pendingMarketRetries.set(key, { ...pending, retryAt: Date.now() + MARKET_RETRY_DELAY_MS });
      console.log('[ArcLive] PRE_BOND_WAIT', { assetId: pending.enriched.assetId, ageMin: ((Date.now() - pending.firstSeenAt) / 60_000).toFixed(1), reason: 'PAIR_NOT_INDEXED' });
      continue;
    }
    const assessment = await assessArcWithSellSafety(market);
    console.log('[ArcLive] MARKET_RETRY_RESULT', {
      assetId: market.assetId,
      symbol: market.symbol,
      liquidityUsd: market.liquidityUsd,
      volume5mUsd: market.volume5mUsd,
      buys5m: market.buys5m,
      sells5m: market.sells5m,
      hooks: market.hooks,
      alertable: assessment.alertable,
      blockedBy: assessment.security.reasons,
    });

    if (assessment.alertable) {
      if (delivered.has(key)) {
        console.log('[ArcLive] DUPLICATE_REVERSAL_SUPPRESSED', { assetId: market.assetId, reason: 'opportunity already delivered' });
        continue;
      }
      const pairAgeMs = market.pairCreatedAt ? Math.max(0, Date.now() - market.pairCreatedAt) : 0;
      if (pairAgeMs < ARC_MIN_NORMAL_ALERT_AGE_MS) {
        pendingMarketRetries.set(key, { enriched: pending.enriched, retryAt: Date.now() + Math.max(ARC_REVERSAL_CONFIRM_MS, ARC_MIN_NORMAL_ALERT_AGE_MS - Math.max(pairAgeMs, Date.now() - pending.firstSeenAt)), firstSeenAt: pending.firstSeenAt, baselinePrice: market.priceUsd });
        console.log('[ArcLive] MATURITY_WAIT', { assetId: market.assetId, ageMin: (pairAgeMs / 60_000).toFixed(1) });
        continue;
      }
      if (pending.baselinePrice && market.priceUsd && market.priceUsd <= pending.baselinePrice) {
        pendingMarketRetries.set(key, { enriched: pending.enriched, retryAt: Date.now() + ARC_REVERSAL_CONFIRM_MS, firstSeenAt: pending.firstSeenAt, baselinePrice: market.priceUsd });
        console.log('[ArcLive] REVERSAL_WAIT', { assetId: market.assetId, previousPrice: pending.baselinePrice, currentPrice: market.priceUsd });
        continue;
      }
      await deliverArcAlert(market, assessment.security.warnings).catch(error => {
        console.error('[ArcLive] ALERT_PROCESSING_FAILED', { assetId: market.assetId, error });
      });
    }
  }
}

type ArcBoostSecurity = { sellabilityBlocked?:boolean; sellabilityVerified?:boolean; allowed: boolean; reason: string; creator?:string|null; devHoldingPercent?: number | null; top10Percent?: number | null; observedAt?: number };

async function fetchArcBoosts() {
  try { return await fetchArcBoostFeed(); }
  catch (error) {
    console.warn('[ArcBoost] feed unavailable', { reason: error instanceof Error ? error.message : String(error) });
    return null; // A failed read must never establish an empty startup baseline.
  }
}

function burnLike(holder: Record<string, unknown>): boolean {
  const address = String(holder.address ?? holder.token_account ?? '').toLowerCase();
  const tag = String(holder.tag ?? '').toLowerCase();
  return address === '0x0000000000000000000000000000000000000000' ||
    address === '0x000000000000000000000000000000000000dead' ||
    tag.includes('burn') || tag.includes('dead') || tag.includes('null address') || tag.includes('black hole');
}

async function loadArcSellSafety(tokenAddress: string): Promise<ArcBoostSecurity> {
  try {
    const url = `https://api.gopluslabs.io/api/v1/token_security/5042?contract_addresses=${encodeURIComponent(tokenAddress)}`;
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return { allowed: false, reason: `honeypot provider unavailable (HTTP ${response.status}); LP check intentionally skipped for BOOST`, devHoldingPercent: null };
    const payload = await response.json() as { result?: Record<string, Record<string, unknown>> };
    const key = tokenAddress.toLowerCase();
    const security = payload.result?.[key] ?? payload.result?.[Object.keys(payload.result ?? {}).find(k => k.toLowerCase() === key) ?? ''];
    return arcBoostSafetyFromEvidence(security);
  } catch (error) {
    return { allowed: false, reason: `honeypot check unavailable: ${error instanceof Error ? error.message : String(error)}; LP check intentionally skipped for BOOST`, devHoldingPercent: null };
  }
}

const arcSellSafetyCache = new Map<string, { at: number; result: ArcBoostSecurity }>();
const arcSellSafetyPending = new Map<string, Promise<ArcBoostSecurity>>();
async function checkArcBoostSecurity(tokenAddress: string): Promise<ArcBoostSecurity> {
  const key = tokenAddress.toLowerCase();
  const cached = arcSellSafetyCache.get(key);
  if (cached && Date.now() - cached.at < (cached.result.allowed ? 30_000 : 60_000)) return cached.result;
  const pending = arcSellSafetyPending.get(key);
  if (pending) return pending;
  if (arcSellSafetyPending.size >= 2) return { allowed: false, reason: 'sellability check busy' };
  const work = loadArcSellSafety(tokenAddress).then(raw => {
    const result = {...raw, observedAt:Date.now()};
    if (arcSellSafetyCache.size >= 100) arcSellSafetyCache.delete(arcSellSafetyCache.keys().next().value!);
    arcSellSafetyCache.set(key, { at: Date.now(), result });
    return result;
  }).finally(() => arcSellSafetyPending.delete(key));
  arcSellSafetyPending.set(key, work);
  return work;
}
async function assessArcWithSellSafety(market: Parameters<typeof assessArcForAlert>[0]) {
  const preliminary = assessArcForAlert(market);
  // Spend no security request on candidates already blocked by market or contract gates.
  const marketBlocked = preliminary.security.reasons.some(reason => reason !== 'SELLABILITY_UNVERIFIED' && reason !== 'UNVERIFIED_V4_HOOK');
  const final = marketBlocked ? preliminary : assessArcForAlert(market, await checkArcBoostSecurity(market.assetId));
  if (!final.alertable) recordRejectedCandidate({chain:'arc',token:market.assetId,pair:market.poolId ?? '',price:market.priceUsd ?? 0,reason:final.security.reasons.join(' | ')});
  return final;
}

function arcBoostIdentity(tokenAddress: string, totalAmount: number): string {
  return `${tokenAddress.toLowerCase()}:${totalAmount}`;
}

async function getStoredArcBoostTotal(tokenAddress: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.from('alpha_alert_events')
      .select('boost_total').eq('chain', 'arc').eq('asset_id', tokenAddress)
      .not('boost_total', 'is', null).order('alerted_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    const total = Number(data?.boost_total);
    return Number.isFinite(total) ? total : null;
  } catch (error) {
    console.warn('[ArcBoost] persistent baseline unavailable; using live baseline', {
      token: tokenAddress.toLowerCase(), reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function persistArcBoostDelivery(boost: {tokenAddress:string;amount:number;totalAmount:number}): Promise<void> {
  const identity = `v1:arc:boost:${arcBoostIdentity(boost.tokenAddress, boost.totalAmount)}`;
  const { error } = await supabase.from('alpha_alert_events').upsert({
    event_identity: identity, opportunity_id: null, asset_id: boost.tokenAddress, chain: 'arc',
    strategy_key: 'arc_boost', lifecycle_action: 'BOOST', lifecycle_state: 'BOOST', alert_type: 'BOOST',
    delivery_identity: identity, boost_total: boost.totalAmount, boost_increment: boost.amount,
    alerted_at: new Date().toISOString(), raw_snapshot: { source: 'ARC_BOOST', totalBoostAmount: boost.totalAmount, boostAmount: boost.amount },
  }, { onConflict: 'event_identity', ignoreDuplicates: true });
  if (error) throw error;
}

async function deliverArcBoost(boost: {tokenAddress:string;amount:number;totalAmount:number}, eventType: 'RECOVERY'|'NEW'|'INCREASE'): Promise<boolean> {
  const key = boost.tokenAddress.toLowerCase();
  const identity = arcBoostIdentity(boost.tokenAddress, boost.totalAmount);
  if (arcBoostDelivered.has(identity)) return false;
  let symbol = 'ARC TOKEN';
  let name: string | null = null;
  let marketCap: number | null = null; let fdv: number | null = null;
      let outcomePrice: number | null = null; let outcomePair: string | null = null;
  let dexUrl: string | null = null;
  let website: string | null = null;
  let twitter: string | null = null;
  let telegram: string | null = null;
  try {
    const response = await governedDexScreenerJson<any[]>({url:`https://api.dexscreener.com/token-pairs/v1/arc/${encodeURIComponent(boost.tokenAddress)}`,caller:'arc_boost_metadata',endpoint:'ARC_TOKEN_PAIRS',cacheKey:`arc-alert-pairs:${boost.tokenAddress.toLowerCase()}`,cacheTtlMs:30000,queueWaitTimeoutMs:750,httpTimeoutMs:3000});
    {
      const pairs = response.value;
      const pair = Array.isArray(pairs) ? pairs.find(p => p?.chainId === 'arc' && String(p?.baseToken?.address ?? '').toLowerCase() === boost.tokenAddress.toLowerCase()) : null;
      symbol = String(pair?.baseToken?.symbol || symbol);
      name = pair?.baseToken?.name ? String(pair.baseToken.name) : null;
      outcomePrice = Number(pair?.priceUsd) || null; outcomePair = pair?.pairAddress ?? null;
          marketCap = arcMarketNumber(pair?.marketCap); fdv = arcMarketNumber(pair?.fdv);
      dexUrl = pair?.url ? String(pair.url) : null;
      const websites = Array.isArray(pair?.info?.websites) ? pair.info.websites : [];
      const socials = Array.isArray(pair?.info?.socials) ? pair.info.socials : [];
      website = websites.find((x:any)=>x?.url)?.url ?? null;
      twitter = socials.find((x:any)=>String(x?.type).toLowerCase()==='twitter')?.url ?? null;
      telegram = socials.find((x:any)=>String(x?.type).toLowerCase()==='telegram')?.url ?? null;
    }
  } catch {}
  const text = [
    '🚀 <b>BOOST DETECTED · ARC</b>',
    '',
    `<b>${symbol}</b>${name ? ` · ${name}` : ''}`,
    `🔥 Boost  <b>${boost.totalAmount} total (+${boost.amount})</b>`,
    ...(marketCap != null ? [`💰 Market Cap  <b>${formatUsd(marketCap)}</b>`] : fdv != null ? [`💰 FDV  <b>${formatUsd(fdv)}</b>`] : []),
    ...([twitter,telegram].some(Boolean)?['<b>SOCIALS</b>',...[twitter?`<a href="${twitter}">X</a>`:null,telegram?`<a href="${telegram}">Telegram</a>`:null].filter(Boolean)]:[]),
    '👤 Dev Holding  <b>Not available</b>',
    '',
    `<code>${boost.tokenAddress}</code>`,
    '',
    '⚠️ <b>Do your own diligence.</b>',
  ].join('\n');
  const buttons = [
    [ ...(dexUrl ? [{ text:'📈 Chart', url:dexUrl }] : []), { text:'🔎 Explorer', url:`https://explorer.arc.io/address/${encodeURIComponent(boost.tokenAddress)}` } ],
    [ ...(website ? [{text:'🌐 Project',url:website}] : []), ...(twitter ? [{text:'𝕏 X',url:twitter}] : []), ...(telegram ? [{text:'✈️ TG',url:telegram}] : []) ],
  ].filter(row => row.length > 0);
  try {
    const delivery = await broadcastArcAlert(text, buttons, boost.tokenAddress, 'ARC_BOOST');
    arcBoostDelivered.add(identity);
    await persistArcBoostDelivery(boost).catch(error => console.warn('[ArcBoost] PERSIST_FAILED', { token:key, totalBoost:boost.totalAmount, reason:error instanceof Error ? error.message : String(error) }));
    console.log('[ArcBoost] ALERT_SENT', { token:key, totalBoost:boost.totalAmount, eventType, messageId:delivery.adminMessageId, delivered:delivery.delivered, failed:delivery.failed });
    return true;
  } catch (error) {
    console.error('[ArcBoost] ALERT_PROCESSING_FAILED', { token:key, totalBoost:boost.totalAmount, eventType, error });
    return false;
  }
}

async function processArcBoosts(): Promise<void> {
  if (Date.now() - lastArcBoostPollAt < ARC_BOOST_POLL_MS) return;
  lastArcBoostPollAt = Date.now();
  const boosts = await fetchArcBoosts();
  if (boosts === null) return;
  for (const boost of boosts) arcDexPaid.seed(boost.tokenAddress);
  if (!arcBoostBaselineReady) {
    let persisted = 0;
    for (const boost of boosts) {
      const storedTotal = await getStoredArcBoostTotal(boost.tokenAddress);
      arcBoostTotals.set(boost.tokenAddress.toLowerCase(), Math.max(storedTotal ?? boost.totalAmount, boost.totalAmount));
      if (storedTotal != null) persisted += 1;
    }
    arcBoostBaselineReady = true;
    console.log('[ArcBoost] BASELINE_READY', { tokens: boosts.length, persisted, recoveryReplay: false });
    // Current feed entries are baseline on startup. Never replay historical BOOSTs after a restart.
    // Genuine later increases still produce a new token+total identity and alert normally.
    return;
  }
  for (const boost of boosts) {
    await processArcBoostObservation(arcBoostTotals, boost, eventType => deliverArcBoost(boost, eventType));
  }
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
    try {
    void runRejectedCandidateReview();
    await processMarketRetries();
    await processArcBoosts();
    await arcDexPaid.tick();
    const current = await getArcBlockNumber();
    if (current <= last) continue;

    const fromBlock = last + 1n;
    const cappedTo = fromBlock + BigInt(MAX_BLOCKS - 1);
    const toBlock = current < cappedTo ? current : cappedTo;
    await processArcBurns(fromBlock, toBlock);
    const pools = await discoverArcV4Pools(fromBlock, toBlock);
    const candidates = pools.map(normalizeArcPoolCandidate).filter((x): x is NonNullable<typeof x> => Boolean(x));
    for (const candidate of candidates) arcDexPaid.seed(candidate.assetId);

    console.log('[ArcLive] scan', { fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), poolsDetected: pools.length, launchCandidates: candidates.length });

    for (const candidate of candidates) {
      const enriched = await enrichArcCandidate(candidate);
      const market = await enrichArcMarket(enriched);
      const assessment = await assessArcWithSellSafety(market);
      console.log('[ArcLive] SECURITY_ASSESSMENT', {
        assetId: market.assetId,
        symbol: market.symbol,
        liquidityUsd: market.liquidityUsd,
        volume5mUsd: market.volume5mUsd,
        buys5m: market.buys5m,
        sells5m: market.sells5m,
        marketCapUsd: market.marketCapUsd,
        hooks: market.hooks,
        alertable: assessment.alertable,
        status: assessment.status,
        blockedBy: assessment.security.reasons,
        warnings: assessment.security.warnings,
      });

      if (assessment.alertable) {
        const key = market.assetId.toLowerCase();
        if (delivered.has(key)) {
          console.log('[ArcLive] DUPLICATE_REVERSAL_SUPPRESSED', { assetId: market.assetId, reason: 'opportunity already delivered' });
          continue;
        }
        const pairAgeMs = market.pairCreatedAt ? Math.max(0, Date.now() - market.pairCreatedAt) : 0;
        if (pairAgeMs < ARC_MIN_NORMAL_ALERT_AGE_MS) {
          pendingMarketRetries.set(key, { enriched, retryAt: Date.now() + Math.max(ARC_REVERSAL_CONFIRM_MS, ARC_MIN_NORMAL_ALERT_AGE_MS - pairAgeMs), firstSeenAt: Date.now(), baselinePrice: market.priceUsd });
          console.log('[ArcLive] MATURITY_WAIT', { assetId: market.assetId, ageMin: (pairAgeMs / 60_000).toFixed(1), waitMin: ((ARC_MIN_NORMAL_ALERT_AGE_MS - pairAgeMs) / 60_000).toFixed(1) });
        } else {
          // Existing pools still require a fresh positive move rather than alerting on a stale snapshot.
          pendingMarketRetries.set(key, { enriched, retryAt: Date.now() + ARC_REVERSAL_CONFIRM_MS, firstSeenAt: Date.now(), baselinePrice: market.priceUsd });
          console.log('[ArcLive] REVERSAL_WATCH', { assetId: market.assetId, ageMin: (pairAgeMs / 60_000).toFixed(1) });
        }
      } else if (market.marketDataSource == null || !enriched.metadataReadable) {
        queueMarketRetry(enriched);
      }
    }

    last = toBlock;
    } catch (error) {
      console.warn('[ArcLive] cycle deferred; scanner checkpoint retained', {
        reason: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 180),
      });
    }
  }
}



const arcStatsCache = new Map<string,{at:number,value:AlertKeyStats}>();
async function arcAlertStats(token:string,expectedPool?:string):Promise<AlertKeyStats>{
 const prior=arcStatsCache.get(token.toLowerCase()+':'+(expectedPool??''));if(prior&&Date.now()-prior.at<30000)return prior.value;
 const [pairRead,supplyRead]=await Promise.allSettled([
 governedDexScreenerJson<any[]>({url:`https://api.dexscreener.com/token-pairs/v1/arc/${token}`,caller:'arc_alert_stats',endpoint:'ARC_TOKEN_PAIRS',priority:'NORMAL',cacheKey:`arc-alert-pairs:${token.toLowerCase()}`,cacheTtlMs:30000,queueWaitTimeoutMs:750,httpTimeoutMs:2000}),
 readResearchTokenSupply(token,'arc')]);
 const pairs=pairRead.status==='fulfilled'&&Array.isArray(pairRead.value.value)?pairRead.value.value:[];
 const pair=pairs.filter(p=>p?.chainId==='arc'&&String(p?.baseToken?.address).toLowerCase()===token.toLowerCase()&&(!expectedPool||String(p.pairAddress).toLowerCase()===expectedPool.toLowerCase())).sort((a,b)=>(arcMarketNumber(b?.liquidity?.usd)??0)-(arcMarketNumber(a?.liquidity?.usd)??0))[0];
 const supply=supplyRead.status==='fulfilled'?supplyRead.value:null;
 const value:AlertKeyStats={pairAddress:/^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(pair?.pairAddress??'')?pair.pairAddress:null,symbol:pair?.baseToken?.symbol??null,name:pair?.baseToken?.name??null,price:arcMarketNumber(pair?.priceUsd),marketCap:arcMarketNumber(pair?.marketCap),fdv:arcMarketNumber(pair?.fdv),liquidity:arcMarketNumber(pair?.liquidity?.usd),volume5m:consistentArcVolume5m(pair?.volume?.m5,pair?.volume?.h24),volume24h:arcMarketNumber(pair?.volume?.h24),move5m:arcSignedNumber(pair?.priceChange?.m5),move1h:arcSignedNumber(pair?.priceChange?.h1),buys:arcMarketNumber(pair?.txns?.m5?.buys),sells:arcMarketNumber(pair?.txns?.m5?.sells),pairCreatedAt:arcMarketNumber(pair?.pairCreatedAt),supply:supply?formatResearchSupply(supply):null,source:pair?'DEXScreener'+(supply?' / on-chain supply':''):supply?'On-chain supply':null,checkedAt:pair&&pairRead.status==='fulfilled'?new Date(pairRead.value.fetchedAt).toISOString().slice(11,19):supply?new Date(supply.checkedAt).toISOString().slice(11,19):null};
 if(arcStatsCache.size>=100)arcStatsCache.delete(arcStatsCache.keys().next().value!);arcStatsCache.set(token.toLowerCase()+':'+(expectedPool??''),{at:Date.now(),value});return value;
}
function arcSignedNumber(value:unknown):number|null{if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
const arcDexPaid=createArcDexPaidWatch({
 security:async token=>arcDeliverySafety('ARC_DEX_PAID',token,checkArcBoostSecurity),
 send:async(token,paymentAt)=>{
  const text=['💎 <b>DEX PAID DETECTED · ARC</b>','Promotion payment confirmed · research event',`Payment age ${Math.max(0,Math.floor((Date.now()-paymentAt)/1000))}s`,'<b>RISK</b>','LP protection, creator history and linked-wallet risks remain unverified.','<b>CONTRACT</b>',`<code>${token}</code>`,'Paid promotion does not establish trading quality.'].join('\n');
  const result=await broadcastArcAlert(text,[[{text:'💎 DexScreener',url:`https://dexscreener.com/arc/${token}`},{text:'🔎 Explorer',url:`https://explorer.arc.io/address/${token}`}]],token,'ARC_DEX_PAID');
  console.log('[ArcDexPaid] SENT',{delivered:result.delivered,failed:result.failed});
 }
});

main().catch(error => {
  console.error('[ArcLive] fatal', error);
  process.exitCode = 1;
});
