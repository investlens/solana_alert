import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

type PendingJob = { nextAt: number; attempts: number; insertedAt: number; priority?: boolean };
const VALID_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/**
 * Persist signature backlog before returning from add(). Small, single-process
 * queue with an atomic rename on the private Echo volume. No executable trades.
 * For multi-replica deployment, replace with a transactional shared queue.
 */
export class EchoQueue {
  private jobs = new Map<string, PendingJob>();
  private running = false;
  dropped = 0;
  constructor(private readonly process: (signature: string) => Promise<void>,
    private readonly now = Date.now, private readonly journalPath?: string) {
    if (!journalPath) return;
    try {
      const saved = JSON.parse(readFileSync(journalPath, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.pending)) throw Error('Invalid Echo pending journal');
      for (const item of saved.pending) {
        if (!Array.isArray(item) || item.length !== 2 || !VALID_SIGNATURE.test(item[0]) ||
          !Number.isFinite(item[1]?.nextAt) || !Number.isInteger(item[1]?.attempts) ||
          !Number.isFinite(item[1]?.insertedAt) ||
          (item[1]?.priority !== undefined && typeof item[1].priority !== 'boolean')) throw Error('Invalid pending item');
        this.jobs.set(item[0], item[1]);
      }
      if (this.jobs.size > 4096) throw Error('Echo pending journal exceeds capacity');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  get size() { return this.jobs.size; }
  private persist() {
    if (!this.journalPath) return;
    mkdirSync(dirname(this.journalPath), { recursive: true, mode: 0o700 });
    const temporary = this.journalPath + '.tmp';
    writeFileSync(temporary, JSON.stringify({ version: 1, pending: [...this.jobs] }), { mode: 0o600 });
    renameSync(temporary, this.journalPath);
  }
  add(signature: string, priority = false) {
    if (!VALID_SIGNATURE.test(signature)) return false;
    const existing = this.jobs.get(signature);
    if (existing) {
      if (priority && !existing.priority) { existing.priority = true; this.persist(); }
      return true;
    }
    if (this.jobs.size >= 4096) { this.dropped++; return false; }
    this.jobs.set(signature, { nextAt: this.now(), attempts: 0, insertedAt: this.now(), priority });
    // Fail closed if storage is down: caller sees an error, service must stop.
    try { this.persist(); } catch (error) { this.jobs.delete(signature); throw error; }
    return true;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = [...this.jobs].filter(([, job]) => this.now() >= job.nextAt);
      const next = due.find(([, job]) => job.priority) ?? due[0];
      if (!next) return;
      const [signature, job] = next;
      try {
        await this.process(signature);
        this.jobs.delete(signature);
        this.persist();
      } catch {
        job.attempts++;
        job.nextAt = this.now() + Math.min(60_000, 500 * 2 ** Math.min(7, job.attempts));
        this.persist();
      }
    } finally { this.running = false; }
  }
}
