import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { EchoRejectReason } from './rpcSignals.js';

export type EchoRejectedSample = {
  signature: string;
  reason: EchoRejectReason;
  at: number;
};
/** Private bounded evidence trail. Never sent to Telegram or printed with raw signatures. */
export class EchoRejectionAudit {
  private samples: EchoRejectedSample[] = [];
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly path: string, private readonly limit = 80) {}
  async load(): Promise<void> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, 'utf8'));
      if (!Array.isArray(value)) throw new Error('Invalid Echo rejection audit state');
      this.samples = value.filter((x): x is EchoRejectedSample =>
        x != null && typeof x === 'object' && typeof x.signature === 'string' &&
        /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(x.signature) &&
        typeof x.reason === 'string' && Number.isFinite(x.at)).slice(-this.limit);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  add(sample: EchoRejectedSample): Promise<void> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sample.signature) || !Number.isFinite(sample.at)) return Promise.resolve();
    if (!this.samples.some(x => x.signature === sample.signature)) {
      this.samples.push(sample);
      if (this.samples.length > this.limit) this.samples.shift();
    }
    // A failed write must not poison all future saves.
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.path), {recursive:true,mode:0o700});
      const tmp = this.path+'.tmp';
      await writeFile(tmp, JSON.stringify(this.samples), {mode:0o600});
      await rename(tmp,this.path);
    });
    return this.writing;
  }
  summary() {
    const counts:Record<string,number>={};
    for (const sample of this.samples) counts[sample.reason]=(counts[sample.reason]??0)+1;
    return {sampled:this.samples.length,capacity:this.limit,counts,rawSignaturesLogged:false};
  }
  snapshot(): EchoRejectedSample[] { return this.samples.map(x=>({...x})); }
}
