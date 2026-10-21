import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// One worker replica on a private persistent volume. Missing files start empty;
// corrupt state fails closed rather than replaying every previously sent alert.
export class EchoStore {
  private entries: Record<string, number> = {};
  constructor(private readonly path: string) {}
  async load() {
    try {
      const state = JSON.parse(await readFile(this.path, 'utf8'));
      if (state.version !== 1 || !state.delivered || typeof state.delivered !== 'object' || Array.isArray(state.delivered) ||
          !Object.values(state.delivered).every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('Invalid Echo state');
      this.entries = state.delivered;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  has(id: string) { return Object.prototype.hasOwnProperty.call(this.entries, id); }
  async delivered(id: string, now: number) {
    const next = Object.fromEntries(Object.entries({ ...this.entries, [id]: now }).filter(([, t]) => t >= now - 86_400).slice(-10_000));
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, delivered: next }), { mode: 0o600 });
    await rename(temporary, this.path);
    this.entries = next;
  }
}
