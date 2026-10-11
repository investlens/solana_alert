// Independent background work cannot hold up polling. Never grow beyond capacity.
export function boundedBackground(limit: number) {
 const active = new Map<string, Promise<unknown>>();
 return { start(key: string, run: () => Promise<unknown>, failed: () => void): boolean {
  if (active.has(key) || active.size >= limit) return false;
  const task = Promise.resolve().then(run).catch(failed).finally(() => active.delete(key));
  active.set(key, task); return true;
 }, get size() { return active.size; } };
}
