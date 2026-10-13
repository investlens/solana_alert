import { AsyncLocalStorage } from 'node:async_hooks';

const context = new AsyncLocalStorage<AbortSignal>();
export const currentRequestSignal = () => context.getStore();
export function throwIfRequestAborted() { currentRequestSignal()?.throwIfAborted(); }

export async function abortable<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let cleanup = () => {};
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(signal.reason ?? new Error('Request aborted'));
    signal.addEventListener('abort', fail, { once: true });
    cleanup = () => signal.removeEventListener('abort', fail);
  });
  try { return await Promise.race([Promise.resolve(work), aborted]); }
  finally { cleanup(); }
}

export async function withRequestDeadline<T>(milliseconds: number, work: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const parent = currentRequestSignal();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new Error(`Operation deadline exceeded after ${milliseconds}ms`)), milliseconds);
  try { return await context.run(signal, () => abortable(work(), signal)); }
  finally { clearTimeout(timer); }
}

// Cancellation removes queued entries; a timed-out waiter never consumes a later slot.
export function createRequestGate(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async (signal: AbortSignal): Promise<() => void> => {
    signal.throwIfAborted();
    if (active >= limit) await new Promise<void>((resolve, reject) => {
      const admit = () => { signal.removeEventListener('abort', cancel); active++; resolve(); };
      const cancel = () => { const index = queue.indexOf(admit); if (index >= 0) queue.splice(index, 1); reject(signal.reason); };
      queue.push(admit); signal.addEventListener('abort', cancel, { once: true });
    });
    else active++;
    let released = false;
    return () => { if (released) return; released = true; active--; queue.shift()?.(); };
  };
}

export async function fetchBuffered(input: RequestInfo | URL, init: RequestInit, signal: AbortSignal, request = fetch): Promise<Response> {
  signal.throwIfAborted();
  const response = await abortable(request(input, { ...init, signal }), signal);
  // Bound the entire response body, not just arrival of HTTP headers.
  const body = await abortable(response.text(), signal);
  signal.throwIfAborted();
  return new Response([204, 205, 304].includes(response.status) ? null : body,
    { status: response.status, statusText: response.statusText, headers: response.headers });
}
