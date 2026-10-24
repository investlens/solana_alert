// One bounded serial lane prevents websocket bursts from multiplying RPC calls.
// Failed jobs remain queued and retry at most three times; reconciliation can
// rediscover recent observations. Old work is discarded, never presented fresh.
export class EchoQueue {
  private jobs = new Map<string, { at: number; attempts: number }>();
  private running = false;
  dropped = 0;
  constructor(private readonly process: (signature: string) => Promise<void>, private readonly now = Date.now) {}
  get size() { return this.jobs.size; }
  add(signature: string) {
    if (this.jobs.has(signature)) return;
    if (this.jobs.size >= 64) { this.dropped++; return; }
    this.jobs.set(signature, { at: this.now(), attempts: 0 });
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const first = this.jobs.entries().next().value;
      if (!first) return;
      const [signature, job] = first;
      if (this.now() - job.at > 120_000) { this.jobs.delete(signature); this.dropped++; return; }
      try { await this.process(signature); this.jobs.delete(signature); }
      catch { job.attempts++; if (job.attempts >= 3) { this.jobs.delete(signature); this.dropped++; } }
    } finally { this.running = false; }
  }
}
