const alertSeen = new Map<string, number>();

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function canSendTokenAlert(token: string | null | undefined, source = 'GLOBAL') {
  if (!token) return false;

  const normalized = token.toLowerCase();
  const globalKey = `GLOBAL:${normalized}`;
  const sourceKey = `${source}:${normalized}`;
  const now = Date.now();

  const globalLastSent = alertSeen.get(globalKey) ?? 0;
  const sourceLastSent = alertSeen.get(sourceKey) ?? 0;
  const lastSent = Math.max(globalLastSent, sourceLastSent);

  if (now - lastSent < SIX_HOURS) {
    console.log('duplicate alert suppressed:', {
      token,
      source,
      minutesAgo: Math.floor((now - lastSent) / 60000),
    });
    return false;
  }

  alertSeen.set(globalKey, now);
  alertSeen.set(sourceKey, now);
  console.log('alert allowed:', { token, source });

  return true;
}