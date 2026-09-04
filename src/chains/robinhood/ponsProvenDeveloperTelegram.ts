import type { PonsProvenDeveloperAlert } from './ponsProvenDeveloperAlert.js';

export type PonsTelegramDeliveryDependencies = {
  persist: typeof import('../../services/alphaSemanticEventService.js')['persistOrLoadAlphaSemanticEventRecord'];
  deliver: typeof import('../../services/alphaSemanticDeliveryService.js')['deliverAlphaSemanticEvent'];
};

const safeText = (value: unknown) => String(value ?? '')
  .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, 'https://api.telegram.org/bot[REDACTED]')
  .replace(/\b\d{8,10}:[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
  .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);

export function describePonsTelegramError(error: unknown): string {
  if (error instanceof Error && /^code=[^ ]+ description=/.test(error.message)) {
    return safeText(error.message);
  }
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const code = row?.code ?? row?.status ?? row?.error_code;
  const description = safeText(row?.description ?? row?.message ?? row?.details ?? row?.hint
    ?? (error instanceof Error ? error.message : error));
  return `${code == null ? '' : `code=${safeText(code)} `}description="${description || 'unknown error'}"`;
}

export async function deliverPonsProvenDeveloperTelegram(
  alert: PonsProvenDeveloperAlert,
  dependencies?: PonsTelegramDeliveryDependencies,
): Promise<{ delivered: number; failed: number }> {
  const deps = dependencies ?? {
    persist: (await import('../../services/alphaSemanticEventService.js')).persistOrLoadAlphaSemanticEventRecord,
    deliver: (await import('../../services/alphaSemanticDeliveryService.js')).deliverAlphaSemanticEvent,
  };
  const event = await deps.persist({
    identity: alert.launchIdentity,
    type: 'PONS_PROVEN_DEV_LAUNCH',
    assetId: alert.tokenAddress,
    chain: 'robinhood',
    // Must stay inside the deployed alpha_alert_events intelligence-state constraint.
    intelligenceState: 'CONFIRMED',
    strategyKey: null,
    rawSnapshot: {
      tokenAddress: alert.tokenAddress,
      developerAddress: alert.developerAddress,
      developerTier: alert.developerTier,
      source: 'PONS_LIVE_INTELLIGENCE',
      executionMode: 'MANUAL_ONLY',
      autoBuyEnabled: false,
    },
  });
  const failures: unknown[] = [];
  const result = await deps.deliver({
    event: { id: event.id, eventIdentity: event.event_identity,
      type: 'PONS_PROVEN_DEV_LAUNCH', assetId: alert.tokenAddress,
      chain: 'robinhood', strategyKey: null },
    message: alert.text,
    buttons: [[{ text: '📈 DexScreener',
      url: `https://dexscreener.com/robinhood/${encodeURIComponent(alert.tokenAddress)}` }]],
    preserveMessage: true,
    onFailure: error => { failures.push(error); },
  });
  if (result.failed > 0) {
    throw new Error(describePonsTelegramError(failures[0] ?? { message: `delivery failed for ${result.failed} recipient(s)` }));
  }
  return result;
}
