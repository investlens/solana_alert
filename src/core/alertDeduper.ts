const alertSeen = new Map<string, number>();

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function canSendTokenAlert(token: string, source = 'GLOBAL') {
  const key = `${source}:${token}`;
  const lastSent = alertSeen.get(key) ?? 0;
  const now = Date.now();

  if (now - lastSent < SIX_HOURS) {
    console.log('duplicate alert suppressed:', {
      token,
      source,
      minutesAgo: Math.floor((now - lastSent) / 60000),
    });
    return false;
  }

  alertSeen.set(key, now);
  return true;
}