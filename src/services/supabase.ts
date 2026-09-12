import { createClient } from '@supabase/supabase-js';
import { runtimeDeliverableUsers } from './runtimeSubscriberRegistry.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) throw new Error('Missing SUPABASE_URL');
if (!supabaseKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

type CachedResponse = {
  body: string;
  status: number;
  statusText: string;
  contentType: string | null;
};

type Lane = 'critical' | 'background';

type LaneState = {
  active: number;
  limit: number;
  queue: Array<() => void>;
};

let deliverableUsersCache: CachedResponse | null = null;
const failOpenReservations = new Set<string>();
const lastGoodCriticalGets = new Map<string, CachedResponse>();

const SUPABASE_REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? 5_000),
);

const CRITICAL_CONCURRENCY = Math.max(
  1,
  Number(process.env.SUPABASE_CRITICAL_CONCURRENCY ?? 2),
);

const BACKGROUND_CONCURRENCY = Math.max(
  1,
  Number(process.env.SUPABASE_BACKGROUND_CONCURRENCY ?? 2),
);

const lanes: Record<Lane, LaneState> = {
  critical: { active: 0, limit: CRITICAL_CONCURRENCY, queue: [] },
  background: { active: 0, limit: BACKGROUND_CONCURRENCY, queue: [] },
};

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestBody(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (typeof init?.body === 'string') return init.body;
  if (typeof Request !== 'undefined' && input instanceof Request) return null;
  return null;
}

function requestMethod(init?: RequestInit): string {
  return String(init?.method ?? 'GET').toUpperCase();
}

function cachedResponse(cache: CachedResponse): Response {
  return new Response(cache.body, {
    status: cache.status,
    statusText: cache.statusText,
    headers: cache.contentType ? { 'content-type': cache.contentType } : undefined,
  });
}

function isDeliverableUsersRead(url: string, init?: RequestInit): boolean {
  const method = requestMethod(init);
  return method === 'GET' && url.includes('/rest/v1/users') && url.includes('is_blocked=eq.false');
}

function isDeliveryReservation(url: string): boolean {
  return url.includes('/rest/v1/rpc/reserve_opportunity_delivery');
}

function isCriticalRequest(url: string, init?: RequestInit): boolean {
  const method = requestMethod(init);

  if (isDeliverableUsersRead(url, init) || isDeliveryReservation(url)) return true;

  if (
    url.includes('/rest/v1/user_tracked_wallets') ||
    url.includes('/rest/v1/wallet_activity_deliveries') ||
    url.includes('/rest/v1/wallet_monitor_cursors') ||
    url.includes('/rest/v1/strategy_settings') ||
    url.includes('/rest/v1/alerts') ||
    url.includes('/rest/v1/alert_deliveries') ||
    url.includes('/rest/v1/users')
  ) {
    return true;
  }

  // Writes that are part of a user action or alert delivery should not sit
  // behind long-running analytics reads.
  if (method !== 'GET' && (
    url.includes('/rest/v1/user_') ||
    url.includes('/rest/v1/wallet_') ||
    url.includes('/rest/v1/alerts') ||
    url.includes('/rest/v1/alert_deliveries')
  )) {
    return true;
  }

  return false;
}

function cacheableCriticalGet(url: string, init?: RequestInit): boolean {
  if (requestMethod(init) !== 'GET') return false;
  return (
    url.includes('/rest/v1/user_tracked_wallets') ||
    url.includes('/rest/v1/wallet_activity_deliveries') ||
    url.includes('/rest/v1/strategy_settings') ||
    isDeliverableUsersRead(url, init)
  );
}

async function acquireLane(lane: Lane): Promise<void> {
  const state = lanes[lane];
  if (state.active < state.limit) {
    state.active += 1;
    return;
  }

  await new Promise<void>((resolve) => {
    state.queue.push(() => {
      state.active += 1;
      resolve();
    });
  });
}

function releaseLane(lane: Lane): void {
  const state = lanes[lane];
  state.active = Math.max(0, state.active - 1);
  const next = state.queue.shift();
  if (next) next();
}

function reservationKey(body: string | null): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const opportunityId = String(parsed.p_opportunity_id ?? '');
    const telegramId = String(parsed.p_telegram_id ?? '');
    const identity = String(parsed.p_delivery_identity ?? '');
    if (!opportunityId || !telegramId) return null;
    return `${opportunityId}:${telegramId}:${identity}`;
  } catch {
    return null;
  }
}

function testingRealtimeEnabled(): boolean {
  return process.env.TESTING_REALTIME_ALERTS === 'true';
}

function normalizeTestingRecipients(rows: any[]): any[] {
  if (!testingRealtimeEnabled()) return rows;
  const adminId = String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '');
  return rows.map((row) => {
    const telegramId = String(row?.telegram_id ?? '');
    if (!telegramId || telegramId === adminId) return row;
    return {
      ...row,
      tier: 'paid',
      subscription_status: 'active',
      free_trial_used: 0,
    };
  });
}

function resilientUsersBody(cachedBody?: string | null): string {
  const merged = new Map<string, any>();

  if (cachedBody) {
    try {
      const cached = JSON.parse(cachedBody);
      if (Array.isArray(cached)) {
        for (const row of cached) {
          const id = String(row?.telegram_id ?? '');
          if (id) merged.set(id, row);
        }
      }
    } catch {
      // Ignore malformed cache and continue with runtime recipients.
    }
  }

  for (const row of runtimeDeliverableUsers({ allRealtime: testingRealtimeEnabled() })) {
    const id = String(row?.telegram_id ?? '');
    if (id) merged.set(id, row);
  }

  return JSON.stringify(normalizeTestingRecipients([...merged.values()]));
}

function runtimeUsersResponse(reason: string): Response {
  const body = resilientUsersBody(deliverableUsersCache?.body ?? null);
  console.warn('[SupabaseResilience] Subscriber database unavailable; using resilient recipient set.', {
    reason,
    runtimeRecipients: runtimeDeliverableUsers({ allRealtime: testingRealtimeEnabled() }).length,
    hasLastGoodCache: Boolean(deliverableUsersCache),
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function rememberCriticalGet(url: string, response: Response): Promise<Response> {
  if (!response.ok) return response;
  const clone = response.clone();
  const rawBody = await clone.text();
  const cache: CachedResponse = {
    body: rawBody,
    status: clone.status,
    statusText: clone.statusText,
    contentType: clone.headers.get('content-type'),
  };
  lastGoodCriticalGets.set(url, cache);

  // Keep the cache bounded. Critical URLs are mostly a small set of stable
  // query shapes, but this prevents unbounded growth from per-user queries.
  if (lastGoodCriticalGets.size > 200) {
    const oldest = lastGoodCriticalGets.keys().next().value;
    if (oldest) lastGoodCriticalGets.delete(oldest);
  }

  return response;
}

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const usersRead = isDeliverableUsersRead(url, init);
  const reservation = isDeliveryReservation(url);
  const body = requestBody(input, init);
  const key = reservation ? reservationKey(body) : null;
  const critical = isCriticalRequest(url, init);
  const lane: Lane = critical ? 'critical' : 'background';

  await acquireLane(lane);

  // The timeout starts only after the request has obtained its lane. Queue
  // time must never consume the network timeout budget.
  const boundedInit: RequestInit = {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
  };

  try {
    const response = await fetch(input, boundedInit);

    if (usersRead && response.ok) {
      const clone = response.clone();
      const rawBody = await clone.text();
      let normalizedBody = rawBody;
      try {
        const rows = JSON.parse(rawBody);
        if (Array.isArray(rows)) normalizedBody = JSON.stringify(normalizeTestingRecipients(rows));
      } catch {
        // Preserve original body if parsing fails.
      }

      deliverableUsersCache = {
        body: normalizedBody,
        status: clone.status,
        statusText: clone.statusText,
        contentType: clone.headers.get('content-type'),
      };

      lastGoodCriticalGets.set(url, deliverableUsersCache);
      if (testingRealtimeEnabled()) return cachedResponse(deliverableUsersCache);
    } else if (critical && cacheableCriticalGet(url, init) && response.ok) {
      await rememberCriticalGet(url, response);
    }

    if (reservation && !response.ok && response.status >= 500) {
      if (key && failOpenReservations.has(key)) {
        console.warn('[SupabaseResilience] Reservation database unavailable; duplicate suppressed in memory.', { key });
        return new Response('false', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (key) failOpenReservations.add(key);
      console.warn('[SupabaseResilience] Reservation database unavailable; allowing Telegram delivery.', {
        key,
        status: response.status,
      });
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (usersRead && !response.ok && response.status >= 500) {
      return runtimeUsersResponse(`HTTP ${response.status}`);
    }

    if (critical && cacheableCriticalGet(url, init) && !response.ok && response.status >= 500) {
      const cached = lastGoodCriticalGets.get(url);
      if (cached) {
        console.warn('[SupabaseResilience] Critical read degraded; serving last-good response.', {
          url,
          status: response.status,
        });
        return cachedResponse(cached);
      }
    }

    return response;
  } catch (error) {
    if (reservation) {
      if (key && failOpenReservations.has(key)) {
        console.warn('[SupabaseResilience] Reservation request failed; duplicate suppressed in memory.', { key });
        return new Response('false', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (key) failOpenReservations.add(key);
      console.warn('[SupabaseResilience] Reservation request failed; allowing Telegram delivery.', {
        key,
        reason: error instanceof Error ? error.message : String(error),
      });
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (usersRead) {
      return runtimeUsersResponse(error instanceof Error ? error.message : String(error));
    }

    if (critical && cacheableCriticalGet(url, init)) {
      const cached = lastGoodCriticalGets.get(url);
      if (cached) {
        console.warn('[SupabaseResilience] Critical request failed; serving last-good response.', {
          url,
          reason: error instanceof Error ? error.message : String(error),
        });
        return cachedResponse(cached);
      }
    }

    console.warn('[SupabaseResilience] Request failed fast.', {
      url,
      lane,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    releaseLane(lane);
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: resilientFetch,
  },
});
