import { extractEchoSignals, type EchoSignal, type EchoTransaction } from './signals.js';
export type EchoDeliveryDependencies = {
  now: () => number;
  store: { has(id: string): boolean; delivered(id: string, now: number): Promise<void> };
  confirmation(signature: string): Promise<'confirmed' | 'failed' | 'pending'>;
  send(signal: EchoSignal): Promise<void>;
};
// Caller serializes batches. Persist only after Telegram acknowledges delivery;
// failures remain eligible for retry. This is at-least-once, not exactly-once.
export async function deliverEchoBatch(transactions: EchoTransaction[], deps: EchoDeliveryDependencies): Promise<number> {
  let count = 0;
  for (const tx of transactions) {
    const signals = extractEchoSignals(tx, deps.now()).filter(s => !deps.store.has(s.id));
    if (!signals.length) continue;
    const confirmation = await deps.confirmation(tx.signature!);
    if (confirmation === 'failed') continue;
    if (confirmation !== 'confirmed') throw new Error('Awaiting confirmation');
    for (const signal of signals) {
      if (deps.now() - signal.timestamp > 120) continue;
      await deps.send(signal);
      await deps.store.delivered(signal.id, deps.now());
      count++;
    }
  }
  return count;
}
