import { getSharedJson, setSharedJson } from './sharedJsonCache.js';
const KEY = 'alphaos:group-research:v1';
const RETENTION = 365 * 24 * 60 * 60_000;
export function createGroupResearchSettings(storage = {
  read: () => getSharedJson<{ groups: string[] }>(KEY),
  write: (groups: string[]) => setSharedJson(KEY, { groups }, new Date().toISOString(), RETENTION),
}) {
  const groups = new Set<string>();
  const ready = storage.read().then(saved => {
    for (const id of saved?.value.groups ?? []) if (/^-\d+$/.test(id) && groups.size < 100) groups.add(id);
  }).catch(() => {});
  let writes = Promise.resolve();
  return {
    async enabled(id: string) { await ready; return groups.has(id); },
    async set(id: string, enabled: boolean) {
      await ready;
      if (!/^-\d+$/.test(id)) return false;
      if (enabled && groups.size >= 100 && !groups.has(id)) return false;
      if (enabled) groups.add(id); else groups.delete(id);
      writes = writes.catch(() => {}).then(() => storage.write([...groups]));
      await writes;
      return true;
    },
  };
}
