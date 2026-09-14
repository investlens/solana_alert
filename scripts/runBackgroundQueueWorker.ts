import 'dotenv/config';
import { Worker, type Job } from 'bullmq';

const enabled = String(process.env.BACKGROUND_QUEUE_WORKER_ENABLED ?? 'false').toLowerCase() === 'true';
const queueName = process.env.BACKGROUND_QUEUE_NAME || 'alphaos-background';
const redisUrl = process.env.REDIS_URL?.trim();

if (!enabled) {
  console.log('[BackgroundWorker] disabled by BACKGROUND_QUEUE_WORKER_ENABLED=false');
  process.exit(0);
}
if (!redisUrl) throw new Error('REDIS_URL is required when background queue worker is enabled');

const url = new URL(redisUrl);
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username || undefined,
  password: url.password || undefined,
  maxRetriesPerRequest: null as null,
};

async function processJob(job: Job<Record<string, unknown>>) {
  // Phase 1 intentionally proves queue transport only. DB handlers are added
  // one at a time after Redis is verified, so production alerting stays isolated.
  console.log('[BackgroundWorker] job received', {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
  });

  switch (job.name) {
    case 'persist-alert':
    case 'persist-observation':
    case 'outcome-checkpoint':
      console.log('[BackgroundWorker] dry handler complete', { id: job.id, name: job.name });
      return { ok: true, dryHandler: true };
    default:
      throw new Error(`Unsupported background job: ${job.name}`);
  }
}

const worker = new Worker(queueName, processJob, {
  connection,
  concurrency: Math.max(1, Math.min(5, Number(process.env.BACKGROUND_QUEUE_CONCURRENCY || 2))),
});

worker.on('ready', () => console.log('[BackgroundWorker] ready', { queue: queueName }));
worker.on('completed', (job) => console.log('[BackgroundWorker] completed', { id: job.id, name: job.name }));
worker.on('failed', (job, error) => console.error('[BackgroundWorker] failed', { id: job?.id, name: job?.name, error }));
worker.on('error', (error) => console.error('[BackgroundWorker] Redis error', error));

async function shutdown(signal: string) {
  console.log('[BackgroundWorker] shutting down', { signal });
  await worker.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
