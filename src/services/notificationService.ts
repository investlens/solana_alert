import { eventEngine } from './eventEngine.js';

function payloadString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function payloadNumber(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const value = payload[key];

  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function formatNumber(value: number | null): string {
  return value === null ? '-' : value.toFixed(2);
}

export function startNotificationService() {
  console.log('[NotificationService] Started.');

  eventEngine.subscribe('*', async (event, result) => {
    const payload = event.payload ?? {};

    const symbol =
      payloadString(payload, 'symbol')
      ?? event.token.tokenAddress;

    const action =
        payloadString(payload, 'actionBucket')
        ?? payloadString(payload, 'decision')
        ?? payloadString(payload, 'action')
        ?? payloadString(payload, 'nextStatus')
        ?? '-';

        const score =
        payloadNumber(payload, 'finalScore')
        ?? payloadNumber(payload, 'adjustedScore')
        ?? payloadNumber(payload, 'baseScore')
        ?? payloadNumber(payload, 'score');

    const persistenceStatus = result.error
      ? 'FAILED'
      : result.duplicate
        ? 'DUPLICATE'
        : result.persisted
          ? 'SAVED'
          : 'NOT_SAVED';

    console.log('[EventMonitor]', {
      time: event.occurredAt,
      eventType: event.eventType,

      chain: event.token.chain,
      token: symbol,

      source: event.source,
      severity: event.severity,

      action,
      score: formatNumber(score),

      persistence: persistenceStatus,
      eventId: result.eventId,
    });
  });
}