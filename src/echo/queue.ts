// Bounded, retryable signature queue. Do not discard a real BUY merely because
// the RPC provider returned HTTP 429 or a transaction was temporarily unavailable.
// Queue jobs remain until a confirmed decision or a manual operational reset.
// This is in-memory only: a durable journal is still required for crash recovery.
export class EchoQueue {
  private jobs = new Map<string, { nextAt: number; attempts: number }>();
  private running = false;
  dropped = 0;
  constructor(private readonly process: (signature: string) => Promise<void>, private readonly now = Date.now) {}
  get size() { return this.jobs.size; }
  add(signature: string) {
    if (this.jobs.has(signature)) return;
    if (this.jobs.size >= 4096) { this.dropped++; return; }
    this.jobs.set(signature, { nextAt: this.now(), attempts: 0 });
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const next = Array.from(this.jobs).find(([, job]) => this.now() >= job.nextAt);
      if (!next) return;
      const [signature, job] = next;
      try { await this.process(signature); this.jobs.delete(signature); }
      catch {
        job.attempts++;
        // Keep unresolved transactions for recovery. Retry progressively more slowly
        // under load; do not turn a provider outage into irrevocably lost signals.
        job.nextAt = this.now() + Math.min(60_000, 500 * 2 ** Math.min(7, job.attempts));
      }
    } finally { this.running = false; }
  }
}
