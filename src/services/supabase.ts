import { createClient } from '@supabase/supabase-js';

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

let deliverableUsersCache: CachedResponse | null = null;
const failOpenReservations = new Set<string>();
const SUPABASE_REQUEST_TIMEOUT_MS = Math.max(
  2_000,
  Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? 5_000),
);

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

function cachedResponse(cache: CachedResponse): Response {
  return new Response(cache.body, {
    status: cache.status,
    statusText: cache.statusText,
    headers: cache.contentType ? { 'content-type': cache.contentType } : undefined,
  });
}

function isDeliverableUsersRead(url: string, init?: RequestInit): boolean {
  const method = String(init?.method ?? 'GET').toUpperCase();
  return method === 'GET' && url.includes('/rest/v1/users') && url.includes('is_blocked=eq.false');
}

function isDeliveryReservation(url: string): boolean {
  return url.includes('/rest/v1/rpc/reserve_opportunity_delivery');
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

async function resilientFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const usersRead = isDeliverableUsersRead(url, init);
  const reservation = isDeliveryReservation(url);
  const body = requestBody(input, init);
  const key = reservation ? reservationKey(body) : null;
  const boundedInit: RequestInit = {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS),
  };

  try {
    const response = await fetch(input, boundedInit);

    if (usersRead && response.ok) {
      const clone = response.clone();
      deliverableUsersCache = {
        body: await clone.text(),
        status: clone.status,
        statusText: clone.statusText,
        contentType: clone.headers.get('content-type'),
      };
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

    if (usersRead && !response.ok && response.status >= 500 && deliverableUsersCache) {
      console.warn('[SupabaseResilience] Users database read unavailable; using last-known-good subscriber list.', {
        status: response.status,
      });
      return cachedResponse(deliverableUsersCache);
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

    if (usersRead && deliverableUsersCache) {
      console.warn('[SupabaseResilience] Users request failed; using last-known-good subscriber list.', {
        reason: error instanceof Error ? error.message : String(error),
      });
      return cachedResponse(deliverableUsersCache);
    }

    console.warn('[SupabaseResilience] Request failed fast.', {
      url,
      reason: error instanceof Error ? error.message : String(error),
    });
    throw error;
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
