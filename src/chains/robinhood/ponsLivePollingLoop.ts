import { concisePonsError } from './ponsHistoricalLaunchScanner.js';

export type PonsLivePollResult = { detected: number; handled: number; duplicates: number };
export type PonsLiveSignal = 'SIGINT' | 'SIGTERM';
export type PonsLiveSignalSource = {
  on(signal: PonsLiveSignal, listener: () => void): void;
  off(signal: PonsLiveSignal, listener: () => void): void;
};
export type PonsLiveDevMode =
  | { kind: 'CONTINUOUS' }
  | { kind: 'ONCE' }
  | { kind: 'REPLAY'; tokenAddress: string };

export function parsePonsLiveDevMode(args: string[]): PonsLiveDevMode {
  const once = args.includes('--once');
  const replayToken = args.find(argument => argument.startsWith('--replay-token='))
    ?.slice('--replay-token='.length).trim();
  if (once && replayToken) throw new Error('--once and --replay-token are mutually exclusive');
  if (replayToken) return { kind: 'REPLAY', tokenAddress: replayToken };
  return once ? { kind: 'ONCE' } : { kind: 'CONTINUOUS' };
}

export function ponsLivePollInterval(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.PONS_LIVE_POLL_INTERVAL_MS ?? 5_000);
  if (!Number.isFinite(value) || value < 100) throw new Error('PONS_LIVE_POLL_INTERVAL_MS must be at least 100');
  return Math.floor(value);
}

export async function runPonsLivePollingLoop(options: {
  poll(): Promise<PonsLivePollResult>;
  pollIntervalMs?: number;
  signalSource?: PonsLiveSignalSource;
  sleep?(delayMs: number): Promise<void>;
  log?(line: string): void;
}): Promise<void> {
  const interval = options.pollIntervalMs ?? 5_000;
  const signals = options.signalSource ?? process;
  const sleep = options.sleep ?? (delay => new Promise(resolve => setTimeout(resolve, delay)));
  const log = options.log ?? console.log;
  let stopping = false;
  const requestShutdown = () => {
    if (!stopping) log('[PonsLive] shutdown requested');
    stopping = true;
  };
  signals.on('SIGINT', requestShutdown);
  signals.on('SIGTERM', requestShutdown);
  log(`[PonsLive] watcher started pollIntervalMs=${interval}`);
  try {
    while (!stopping) {
      try {
        const result = await options.poll();
        log(`[PonsLive] handled=${result.handled} detected=${result.detected} duplicates=${result.duplicates}`);
      } catch (error) {
        log(`[PonsLive] poll failed reason=${concisePonsError(error)}; retrying next cycle`);
      }
      if (stopping) break;
      log('[PonsLive] sleeping...');
      await sleep(interval);
    }
  } finally {
    signals.off('SIGINT', requestShutdown);
    signals.off('SIGTERM', requestShutdown);
    log('[PonsLive] stopped');
  }
}
