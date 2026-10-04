import { governedDexScreenerJson } from './dexscreenerRequestGovernor.js';
import { getSharedJson, setSharedJson } from './sharedJsonCache.js';
import { escapeTelegramHtml as esc } from '../ui/escapeHtml.js';

type Candidate = { chain: 'robinhood' | 'arc'; token: string; pair: string; price: number; reason: string; at: number };
type Review = Candidate & { status: 'MEASURED' | 'UNAVAILABLE'; checkedAt: number; change: number | null };
const validPrice = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
export function comparableReviewPrice(payload: unknown, row: Candidate): number | null {
  if (!Array.isArray(payload)) return null;
  const pair = payload.find(p => p?.chainId === row.chain && String(p?.baseToken?.address).toLowerCase() === row.token
    && String(p?.pairAddress).toLowerCase() === row.pair);
  const price = pair?.priceUsd == null || pair.priceUsd === '' ? NaN : Number(pair.priceUsd);
  return validPrice(price) ? price : null;
}
export function createRejectedCandidateReview(read: (row: Candidate) => Promise<unknown>, clock = Date.now) {
  const pending = new Map<string, Candidate>();
  const reviews = new Map<string, Review>();
  const alerted = new Map<string,number>();
  const key = (r: Pick<Candidate, 'chain' | 'token'>) => `${r.chain}:${r.token.toLowerCase()}`;
  let running = false, lastCheck = -Infinity;
  function prune() {
    for (const [k, at] of alerted) if (clock()-at > 2*3_600_000) alerted.delete(k);
    for (const [k, r] of pending) if (clock() - r.at > 35 * 60_000) pending.delete(k);
    for (const [k, r] of reviews) if (clock() - r.at > 2 * 3_600_000) reviews.delete(k);
  }
  return {
    admit(row: Omit<Candidate, 'at'>) {
      prune();
      if (!['arc', 'robinhood'].includes(row.chain) || !/^0x[a-f0-9]{40}$/i.test(row.token)
        || !/^0x[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(row.pair) || !validPrice(row.price)) return;
      const id = key(row);
      if (alerted.has(id) || pending.has(id) || reviews.has(id) || pending.size >= 6) return;
      pending.set(id, { ...row, token: row.token.toLowerCase(), pair: row.pair.toLowerCase(), reason: row.reason.slice(0, 120), at: clock() });
    },
    alerted(chain: string, token: string) { const id = `${chain}:${token.toLowerCase()}`; pending.delete(id); reviews.delete(id);
      if (alerted.size >= 100) alerted.delete(alerted.keys().next().value!); alerted.set(id,clock()); },
    async tick() {
      prune();
      if (running || clock() - lastCheck < 60_000) return false;
      const row = [...pending.values()].find(r => clock() - r.at >= 30 * 60_000);
      if (!row) return false;
      running = true; lastCheck = clock();
      try {
        let price: number | null = null;
        try { price = comparableReviewPrice(await read(row), row); } catch { /* Unknown is never a failed investment. */ }
        pending.delete(key(row));
        if (alerted.has(key(row))) return false;
        if (reviews.size >= 12) reviews.delete(reviews.keys().next().value!);
        reviews.set(key(row), { ...row, checkedAt: clock(), status: price == null ? 'UNAVAILABLE' : 'MEASURED',
          change: price == null ? null : (price / row.price - 1) * 100 });
        return true;
      } finally { running = false; }
    },
    snapshot() { prune(); return { observedAt: clock(), pending: pending.size, reviews: [...reviews.values()] }; },
  };
}
const review = createRejectedCandidateReview(async row => (await governedDexScreenerJson<unknown>({
  url: `https://api.dexscreener.com/token-pairs/v1/${row.chain}/${row.token}`, caller: 'rejected-review', endpoint: 'TOKEN_PAIRS',
  priority: 'BACKGROUND', cacheKey: `review:${row.chain}:${row.token}`, cacheTtlMs: 30_000, queueWaitTimeoutMs: 500, httpTimeoutMs: 2_000,
})).value);
export const recordRejectedCandidate = review.admit;
export const removeAlertedCandidate = review.alerted;
export async function runRejectedCandidateReview() {
  if (await review.tick()) {
    const snapshot = review.snapshot();
    console.log('[RejectedReview]', JSON.stringify({ pending: snapshot.pending, measured: snapshot.reviews.filter(r => r.status === 'MEASURED').length, cap: 6, maxChecksPerMinute: 1, dbWrites: 0 }));
    const service = process.env.RAILWAY_SERVICE_ID;
    if (service) await setSharedJson(`alphaos:rejected-review:${service}`, snapshot, new Date().toISOString(), 2 * 3_600_000);
  }
}
export async function rejectedReviewText(): Promise<string> {
  const snapshots = await Promise.all(['ff20240d-fd6c-4584-b05e-5394bdfa06df', 'e127922b-fff0-4799-90b3-810915666516'].map(async id =>
    id === process.env.RAILWAY_SERVICE_ID ? review.snapshot() : (await getSharedJson<ReturnType<typeof review.snapshot>>(`alphaos:rejected-review:${id}`))?.value));
  const rows = snapshots.flatMap(s => s?.reviews ?? []).filter(r => Date.now() - r.at <= 2 * 3_600_000).sort((a, b) => (b.change ?? -Infinity) - (a.change ?? -Infinity)).slice(0, 8);
  return ['🔬 <b>REJECTED CANDIDATE REVIEW</b>', 'Small first-admitted sample · Approximately 30-minute price follow-up', '',
    ...(rows.length ? rows.flatMap(r => [`<b>${esc(r.chain)} · ${r.change == null ? 'Data unavailable' : (r.change >= 0 ? '+' : '') + r.change.toFixed(1) + '%'}</b>`,
      `<code>${esc(r.token)}</code>`, `Rejected for: ${esc(r.reason)}`, `Baseline ${new Date(r.at).toISOString().slice(11,19)} UTC · Checked ${new Date(r.checkedAt).toISOString().slice(11,19)} UTC`, ''])
      : ['No completed sample available. New comparable candidates need about 30 minutes.', '']),
    'Exact chain/token/pool comparison · Gross price change only.',
    'Not all rejected tokens; unsafe candidates may rise too. This does not justify removing security checks.',
    'Later alerts are removed when observed by this worker. Cross-worker delivery history is not exhaustive.',
    '6 pending / 12 results per worker · Results expire after 2 hours · No database writes.',
  ].join('\n');
}
