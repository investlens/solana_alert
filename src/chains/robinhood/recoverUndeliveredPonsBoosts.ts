import { supabase } from '../../services/supabase.js';
import { deliverAlphaSemanticEvent } from '../../services/alphaSemanticDeliveryService.js';
import { classifyRobinhoodLaunch } from './launchSecurity.js';
import { buildBoostActions, buildBoostMessage } from './robinhoodBoostObserver.js';

const RECOVERY_LOOKBACK_MINUTES = 15;
const RECOVERY_INTERVAL_MS = 60_000;
const INITIAL_RECOVERY_DELAY_MS = 25_000;

let recoveryStarted = false;
let recoveryRunning = false;
let recoveryTimer: ReturnType<typeof setInterval> | null = null;

function asNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function recoverUndeliveredPonsBoosts(): Promise<number> {
  if (recoveryRunning) return 0;
  recoveryRunning = true;

  try {
    const since = new Date(Date.now() - RECOVERY_LOOKBACK_MINUTES * 60_000).toISOString();
    const { data: events, error } = await supabase
      .from('alpha_alert_events')
      .select('id,event_identity,asset_id,chain,strategy_key,symbol,token_name,alert_type,raw_snapshot,created_at')
      .eq('chain', 'robinhood')
      .eq('alert_type', 'BOOST')
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (error) throw error;

    let recovered = 0;
    for (const event of events ?? []) {
      const token = String(event.asset_id ?? '').trim();
      if (!token) continue;

      const launchType = await classifyRobinhoodLaunch(token);
      if (launchType !== 'PONS') continue;

      const { data: delivered, error: deliveryLookupError } = await supabase
        .from('alpha_alert_event_deliveries')
        .select('id')
        .eq('alert_event_id', event.id)
        .eq('delivery_channel', 'telegram')
        .not('delivered_at', 'is', null)
        .limit(1);
      if (deliveryLookupError) throw deliveryLookupError;
      if ((delivered ?? []).length > 0) continue;

      const raw = asRecord(event.raw_snapshot);
      const boostTotal = asNumber(raw.boostTotal) ?? 0;
      const boostIncrement = asNumber(raw.boostIncrement) ?? boostTotal;
      const symbol = String(event.symbol ?? token.slice(0, 6));
      const message = buildBoostMessage({
        symbol,
        name: event.token_name ?? null,
        tokenAddress: token,
        boostAmount: boostIncrement,
        totalBoostAmount: boostTotal,
        price: asNumber(raw.price),
        marketCap: asNumber(raw.marketCap),
        fdv: asNumber(raw.fdv),
        liquidity: asNumber(raw.liquidity),
        volume5m: asNumber(raw.volume5m),
        buys5m: asNumber(raw.buys5m),
        sells5m: asNumber(raw.sells5m),
        devHoldingPercent: asNumber(raw.devHoldingPercent),
        burnedPercent: asNumber(raw.burnedPercent),
        holderTop1Percent: null,
        eventType: raw.eventType === 'INCREASE' ? 'INCREASE' : 'NEW',
        rawData: raw,
        marketContext: {
          symbol,
          name: event.token_name ?? null,
          address: token,
          price: asNumber(raw.price),
          marketCap: asNumber(raw.marketCap),
          fdv: asNumber(raw.fdv),
          liquidity: asNumber(raw.liquidity),
          volume5m: asNumber(raw.volume5m),
          chartUrl: typeof raw.chartUrl === 'string' ? raw.chartUrl : null,
        },
      });

      const result = await deliverAlphaSemanticEvent({
        event: {
          id: Number(event.id),
          eventIdentity: String(event.event_identity),
          type: 'BOOST',
          assetId: token,
          chain: 'robinhood',
          strategyKey: event.strategy_key ?? null,
        },
        message,
        buttons: buildBoostActions({
          tokenAddress: token,
          chartUrl: typeof raw.chartUrl === 'string' ? raw.chartUrl : null,
          strategyKey: event.strategy_key ?? null,
          rawData: raw,
        }),
      });

      if (result.delivered > 0) {
        recovered += 1;
        console.log('[PonsBoostRecovery] Recovered undelivered PONS BOOST.', {
          alertEventId: event.id,
          token,
          symbol,
          boostTotal,
          delivered: result.delivered,
        });
      }
    }

    return recovered;
  } catch (error) {
    console.error('[PonsBoostRecovery] Recovery pass failed.', {
      reason: error instanceof Error ? error.message : String(error),
    });
    return 0;
  } finally {
    recoveryRunning = false;
  }
}

export function startUndeliveredPonsBoostRecovery(): ReturnType<typeof setInterval> | null {
  if (recoveryStarted) return recoveryTimer;
  recoveryStarted = true;

  setTimeout(() => {
    void recoverUndeliveredPonsBoosts();
  }, INITIAL_RECOVERY_DELAY_MS);

  recoveryTimer = setInterval(() => {
    void recoverUndeliveredPonsBoosts();
  }, RECOVERY_INTERVAL_MS);

  console.log('[PonsBoostRecovery] Armed.', {
    initialDelayMs: INITIAL_RECOVERY_DELAY_MS,
    intervalMs: RECOVERY_INTERVAL_MS,
    lookbackMinutes: RECOVERY_LOOKBACK_MINUTES,
  });

  return recoveryTimer;
}
