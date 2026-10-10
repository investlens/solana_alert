import { randomUUID } from 'node:crypto';
import { runSharedAtomic } from './sharedJsonCache.js';

// Reuse the existing key namespace so historical claims still prevent duplicates.
// A timed-out SET may have succeeded: retry with the SAME owner, never fail open.
export const RECIPIENT_CLAIM = `
local current = redis.call('GET', KEYS[1])
if not current or current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 'CLAIMED'
end
if string.sub(current, 1, 10) == 'DELIVERED:' then return 'DELIVERED' end
return 'UNCONFIRMED'`;
export const RECIPIENT_FINISH = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == 'RELEASE' then return redis.call('DEL', KEYS[1]) end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1`;
type Atomic = typeof runSharedAtomic;
const ttl = 24 * 60 * 60_000;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function acquireRecipientClaim(event: string, recipient: string,
  atomic: Atomic = runSharedAtomic, wait = pause) {
  const key = `alphaos:dex:delivery:${event}:${recipient}`;
  const owner = `PENDING:${randomUUID()}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const state = await atomic(RECIPIENT_CLAIM, [key], [owner, String(ttl)]);
      if (state === 'DELIVERED' || state === 'UNCONFIRMED') return { state } as const;
      if (state !== 'CLAIMED') throw new Error('Invalid recipient claim response');
      return { state: 'CLAIMED' as const,
        finish: async (messageId: number | null) => {
          const result = await atomic(RECIPIENT_FINISH, [key], [owner, `DELIVERED:${messageId ?? 'accepted'}`, String(ttl)]);
          if (result !== 1) throw new Error('Recipient delivery confirmation lost');
        },
        release: async () => {
          await atomic(RECIPIENT_FINISH, [key], [owner, 'RELEASE', String(ttl)]);
        },
      };
    } catch (error) {
      if (attempt === 2) throw error;
      await wait(attempt === 0 ? 1000 : 30_000);
    }
  }
  throw new Error('Recipient claim unavailable');
}

// Only explicit Telegram rejection proves that a message was not accepted.
// Network errors/timeouts remain claimed because retrying could send a duplicate.
export function telegramExplicitRejection(error: unknown): boolean {
  return /Telegram (?:send failed|delivery rejected): 4\d\d\b/i.test(String(error));
}

export async function retryTelegramRejection<T>(send: () => Promise<T>, wait = pause): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); } catch (error) {
      if (attempt >= 2 || !/Telegram (?:send failed|delivery rejected): 429\b/i.test(String(error))) throw error;
      const seconds = Number(String(error).match(/retry_after["\s:]+(\d+)/)?.[1] ?? 1);
      if (seconds > 30) throw error;
      await wait(Math.max(1000, seconds * 1000));
    }
  }
}
