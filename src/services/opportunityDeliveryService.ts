import {
  resolveTokenOpenTarget,
} from '../core/tokenOpenRouter.js';

import {
  scanRobinhoodDevTokenFlow,
} from '../chains/robinhood/security/devTokenFlowScanner.js';
import {
  getSolanaCoreMarketIntelligence,
  mergeSolanaCoreMarketIntelligence,
} from '../chains/solana/coreMarketIntelligence.js';

import {
  eventEngine,
} from './eventEngine.js';

import {
  supabase,
} from './supabase.js';

import {
  sendTelegram,
  type InlineButton,
} from './telegram.js';

import {
  isStrategyEnabledForUser,
} from './strategyService.js';

import {
  getDeliverableUsers,
  markTelegramUserBlocked,
  type DeliverableUser,
} from '../core/delivery.js';

import {
  opportunityDeliveryIdentity,
} from './opportunityDeliveryIdentity.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import {
  assertAlphaActions,
  compactAlphaAddress,
  renderAlphaNotification,
  type AlphaNotificationState,
} from '../ui/alphaNotification.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';
import { coreDecisionEvidenceMetrics, marketContextMetrics, normalizeCoreDecisionMetrics, normalizeNotificationMarketContext, verifiedPonsPreIndexValuation, type NotificationMarketContext } from '../ui/notificationMarketContext.js';
import { resolvePonsDeliveryContext } from './ponsDeliveryContext.js';
import { persistAlphaAlertEvent } from './alphaAlertLedger.js';
import { criticalAvoidReason, shouldDeliverExit, userHasExitRelevance } from './alphaExitRelevance.js';
import { buildPremiumTokenNotification } from '../ui/premiumTokenNotification.js';
import { extractAutomaticSocials } from '../ui/alphaNotificationActions.js';
import { loadPriorDeliveredAlertComparison, type AlertComparison } from './alertComparisonService.js';
import { evaluateProAlertNotification, type ProAlertDecision } from './proAlertNotificationGovernor.js';
import { config } from '../config.js';
import { analyzeRobinhoodTokenFreshWallets, freshWalletBlockPersistence, freshWalletRiskBlocksPositive, getCachedRobinhoodFreshWallets } from './tokenIntelligenceService.js';

const ALPHAOS_WEB_BASE_URL = (process.env.ALPHAOS_WEB_URL ?? 'https://alphaos-web-preview-production.up.railway.app').replace(/\/+$/, '');

export function alphaOsIntelligenceUrl(assetId: string): string {
  return `${ALPHAOS_WEB_BASE_URL}/intelligence/${encodeURIComponent(assetId)}`;
}

type DeliverableAction =
  | 'BUY'
  | 'CHECK_ENTRY'
  | 'EXIT';

type OpportunityRow = {
  id: number;
  asset_id: string;
  chain: string | null;
  strategy_key: string | null;
  recommended_action: string | null;
  status: string;
  title: string | null;
  why: string | null;
  what_happened: string | null;
  invalidation: string | null;
  risk_reason: string | null;
  confidence: number | null;
  risk_score: number | null;
  raw_data: Record<string, unknown> | null;
};

const ACTIONABLE =
  new Set<string>([
    'BUY',
    'CHECK_ENTRY',
    'EXIT',
  ]);

export function qualifyPremiumOpportunity(raw: Record<string, unknown> | null, action: string, assetId?: string) {
  if (!['BUY', 'CHECK_ENTRY'].includes(action.toUpperCase())) return { eligible: false, reason: 'NOT_OPPORTUNITY' };
  const data = raw ?? {};
  const age = Number(data.elapsedSec); const move = Number(data.currentRoi ?? data.roi);
  const peak = Number(data.recentPeakRoi ?? data.peakRoi ?? move);
  const retention = Number.isFinite(move) && Number.isFinite(peak) && peak > 0 ? move / peak : 0;
  const currentVolume = Number(data.volume5m); const previousVolume = Number(data.previousVolume5m);
  const volumeMultiple = Number.isFinite(currentVolume) && currentVolume > 0 && Number.isFinite(previousVolume) && previousVolume > 0
    ? currentVolume / previousVolume : Number(data.volumeMultiple);
  const critical = data.confirmedDevSell === true || data.criticalSecurity === true || data.liquidityCritical === true;
  const freshWallet1dPct = Number(data.freshWallet1dPct);
  const freshWalletEvidence = String(data.freshWalletEvidence ?? 'UNKNOWN');
  if (freshWalletEvidence === 'VERIFIED' && Number.isFinite(freshWallet1dPct) &&
      freshWallet1dPct > config.maxFreshWallet1dPct) {
    return { eligible: false, reason: 'HIGH_FRESH_WALLET_CONCENTRATION', volumeMultiple,
      freshWallet1dPct };
  }
  if (!Number.isFinite(age) || !Number.isFinite(move) || move <= 0 || retention < 0.5 || critical) {
    return { eligible: false, reason: 'INSUFFICIENT_HEALTHY_STRUCTURE', volumeMultiple };
  }
  const unusualEarly = age < 120 && volumeMultiple >= 3 && move >= 10;
  if (age < 120) return { eligible: unusualEarly, reason: unusualEarly ? 'UNUSUALLY_STRONG_EARLY_EVIDENCE' : 'EARLY_OBSERVATION_WINDOW', volumeMultiple };
  if (age < 900) {
    const curve = verifiedPonsPreIndexValuation(data, assetId ?? String(data.address ?? data.tokenAddress ?? data.asset_id ?? '')) != null;
    const strong = volumeMultiple >= 1.5 || (curve && move >= 8);
    return { eligible: strong, reason: strong ? 'SUSTAINED_STRONG_EVIDENCE' : 'MORE_PARTICIPATION_REQUIRED', volumeMultiple };
  }
  const survivedWithVolume = volumeMultiple >= 1.5;
  return { eligible: survivedWithVolume, reason: survivedWithVolume ? 'SURVIVAL_AND_VOLUME_ACCELERATION' : 'SURVIVAL_WITHOUT_IGNITION', volumeMultiple };
}

function executionAvailable(opportunity: OpportunityRow): boolean {
  return String(opportunity.chain ?? '').toLowerCase() === 'solana';
}

export function buildButtons(
  opportunity: OpportunityRow,
  tokenTarget: Awaited<ReturnType<typeof resolveTokenOpenTarget>>,
  user: DeliverableUser,
): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const socials = extractAutomaticSocials(opportunity.raw_data);

  // Always give the user a one-tap path back into AlphaOS. This deep-links to
  // the exact contract rather than asking the user to open the bot/web home and search.
  rows.push([{
    text: '🧠 Open AlphaOS',
    url: alphaOsIntelligenceUrl(opportunity.asset_id),
  }]);

  if (
    executionAvailable(opportunity) &&
    hasCapability(accessProfileForUser(user), 'trading.admin')
  ) {
    rows.push([{
      text: '⚡ Trade',
      callback_data: `OPP_TRADE_${opportunity.id}`,
    }]);
  }

  const hasFullIntel = /^0x[a-fA-F0-9]{40}$/.test(opportunity.asset_id);
  const marketActions: InlineButton[] = [];
  if (hasFullIntel) marketActions.push({ text: '🔬 Full Intel', callback_data: `FI_RH_${opportunity.asset_id}` });
  if (tokenTarget.chartUrl && tokenTarget.chartUrl !== tokenTarget.tokenUrl) marketActions.push({ text: '📊 Chart', url: tokenTarget.chartUrl });
  if (!hasFullIntel) marketActions.push({ text: '🔎 Token', url: tokenTarget.tokenUrl });
  if (marketActions.length) rows.push(marketActions);

  const socialActions: InlineButton[] = [];
  if (socials.xUrl) socialActions.push({ text: '𝕏 X', url: socials.xUrl });
  if (socials.telegramUrl) socialActions.push({ text: '✈️ Telegram', url: socials.telegramUrl });
  if (socialActions.length) rows.push(socialActions);

  const preferenceActions: InlineButton[] = [{
    text: '⭐ Track',
    callback_data: `OPP_TRACK_${opportunity.id}`,
  }];

  if (hasFullIntel) preferenceActions.push({ text: '📋 Copy CA', callback_data: `COPY_CA_${opportunity.asset_id}` });

  if (
    opportunity.strategy_key &&
    Buffer.byteLength(`STRAT_TOGGLE_${opportunity.strategy_key}`, 'utf8') <= 64
  ) {
    rows.push(preferenceActions);
    rows.push([{ text: '🔕 Mute', callback_data: `STRAT_TOGGLE_${opportunity.strategy_key}` }]);
    return assertAlphaActions(rows);
  }
  rows.push(preferenceActions);

  return assertAlphaActions(rows);
}

// Remaining opportunity-delivery implementation is intentionally unchanged below.
