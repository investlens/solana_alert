import { Queue } from 'bullmq';

export type BackgroundJobName =
  | 'persist-alert'
  | 'outcome-checkpoint'
  | 'persist-observation';

export type BackgroundJobPayload = Record<string, unknown>;

const QUEUE_NAME = process.env.BACKGROUND_QUEUE_NAME || 'alphaos-background';
let queue: Queue | null = null;
let warnedUnavailable = false;

export function backgroundQueueEnabled(): boolean {
  return String(process.env.BACKGROUND_QUEUE_ENABLED ?? 'false').toLowerCase() === 'true';
}

function redisConnection() {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) return null;
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null as null,
  };
}

function getQueue(): Queue | null {
  if (!backgroundQueueEnabled()) return null;
  if (queue) return queue;

  const connection = redisConnection();
  if (!connection) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn('[BackgroundQueue] disabled: REDIS_URL is missing');
    }
    return null;
  }

  queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400, count: 5_000 },
      removeOnFail: { age: 604_800, count: 5_000 },
    },
  });
  queue.on('error', (error) => console.error('[BackgroundQueue] Redis error', error));
  console.log('[BackgroundQueue] producer ready', { queue: QUEUE_NAME });
  return queue;
}

export async function enqueueBackgroundJob(
  name: BackgroundJobName,
  payload: BackgroundJobPayload,
  options: { delayMs?: number; jobId?: string } = {},
): Promise<boolean> {
  const target = getQueue();
  if (!target) return false;

  try {
    await target.add(name, payload, {
      delay: Math.max(0, options.delayMs ?? 0),
      jobId: options.jobId,
    });
    return true;
  } catch (error) {
    // Fail open: queue trouble must never block Telegram/live evaluation.
    console.error('[BackgroundQueue] enqueue failed', { name, error });
    return false;
  }
}

export async function closeBackgroundQueue(): Promise<void> {
  if (!queue) return;
  await queue.close();
  queue = null;
}
