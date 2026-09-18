const trackedByUser = new Map<string, Set<string>>();

export function trackRuntimeToken(userId: string, tokenAddress: string): boolean {
  const user = String(userId ?? '').trim();
  const token = String(tokenAddress ?? '').trim().toLowerCase();
  if (!user || !/^0x[a-f0-9]{40}$/.test(token)) return false;
  const set = trackedByUser.get(user) ?? new Set<string>();
  const before = set.size;
  set.add(token);
  trackedByUser.set(user, set);
  return set.size > before;
}

export function isRuntimeTokenTracked(userId: string, tokenAddress: string): boolean {
  return trackedByUser.get(String(userId ?? '').trim())?.has(String(tokenAddress ?? '').trim().toLowerCase()) ?? false;
}

export function runtimeTrackedTokens(userId: string): string[] {
  return [...(trackedByUser.get(String(userId ?? '').trim()) ?? new Set<string>())];
}
