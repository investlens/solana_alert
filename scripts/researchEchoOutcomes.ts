/**
 * Echo caller outcome research — offline, read-only. No RPC, Telegram, DB or trading access.
 * Input: JSONL, one record per observed price point:
 * {"caller":"Cupsey","mint":"...","signature":"...","deliveryAt":1234567890,
 *  "observedAt":1234567950,"priceUsd":0.000001,"liquidityUsd":30000,"marketCapUsd":60000}
 * Include a price at/after delivery and later observations for each signature.
 * Output: descriptive statistics ONLY; null means insufficient observations.
 * Usage: npx tsx scripts/researchEchoOutcomes.ts ./echo-price-observations.jsonl
 */
import { readFile } from 'node:fs/promises';

type Obs = { caller: string; mint: string; signature: string; deliveryAt: number;
  observedAt: number; priceUsd: number; liquidityUsd?: number; marketCapUsd?: number };
const horizons = [300, 900, 1800, 3600, 21600, 86400] as const;
function valid(v: any): v is Obs {
  return v && typeof v.caller === 'string' && typeof v.mint === 'string' &&
    typeof v.signature === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v.signature) &&
    Number.isFinite(v.deliveryAt) && Number.isFinite(v.observedAt) &&
    Number.isFinite(v.priceUsd) && v.priceUsd > 0 &&
    v.observedAt >= v.deliveryAt && v.observedAt <= v.deliveryAt + 86400 + 600;
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a,b) => a-b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
const path = process.argv[2];
if (!path) throw new Error('Provide a local JSONL price observation file. No network requests are made.');
const observations: Obs[] = [];
let malformed = 0;
for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
  if (!line.trim()) continue;
  try { const obj = JSON.parse(line); if (valid(obj)) observations.push(obj); else malformed++; }
  catch { malformed++; }
}
const bySignature = new Map<string, Obs[]>();
for (const row of observations) {
  const k = row.signature + ':' + row.mint + ':' + row.caller;
  const prev = bySignature.get(k) || [];
  prev.push(row); bySignature.set(k, prev);
}
type Result = { caller: string; signature: string; mint: string; returns: Record<number, number | null>; maxDrawdown: number | null;
  marketCapUsd: number | null; liquidityUsd: number | null };
const result: Result[] = [];
let noEntry = 0;
for (const group of bySignature.values()) {
  group.sort((a,b) => a.observedAt - b.observedAt);
  const first = group[0];
  // Never use pre-alert price or a distant first observation as an executable entry.
  const entry = group.find(p => p.observedAt <= first.deliveryAt + 60);
  if (!entry) { noEntry++; continue; }
  const returns: Record<number,number | null> = {};
  for (const horizon of horizons) {
    // Strict sampling tolerance: a point within 60 seconds AFTER the intended checkpoint.
    const checkpoint = first.deliveryAt + horizon;
    const point = group.find(p => p.observedAt >= checkpoint && p.observedAt <= checkpoint + 60);
    returns[horizon] = point ? 100 * (point.priceUsd / entry.priceUsd - 1) : null;
  }
  let peak = entry.priceUsd, worst = 0;
  for (const point of group.filter(p => p.observedAt >= entry.observedAt)) {
    peak = Math.max(peak, point.priceUsd);
    worst = Math.min(worst, 100 * (point.priceUsd / peak - 1));
  }
  result.push({ caller: first.caller, mint: first.mint, signature: first.signature, returns,
    maxDrawdown: group.length >= 2 ? worst : null,
    marketCapUsd: entry.marketCapUsd ?? null, liquidityUsd: entry.liquidityUsd ?? null });
}
const callers = [...new Set(result.map(r=>r.caller))].sort();
const byCaller = callers.map(caller => {
  const rows = result.filter(r=>r.caller === caller);
  return { caller, entryPriced: rows.length, horizons: Object.fromEntries(horizons.map(h => {
    const values = rows.map(x=>x.returns[h]).filter((v):v is number => v !== null);
    return [h, { sample: values.length, winRate: values.length ? values.filter(x=>x>0).length/values.length : null,
      medianReturnPct: median(values), meanReturnPct: values.length ? values.reduce((a,b)=>a+b,0)/values.length : null }];
  })), medianObservedDrawdownPct: median(rows.map(r=>r.maxDrawdown).filter((v):v is number=>v!==null)) };
});
console.log(JSON.stringify({ schema:'alphaos.echo.outcome-research.v1', inputRows:observations.length,
  invalidRows:malformed, distinctSignals:bySignature.size, skippedMissingPromptEntry:noEntry,
  scoredSignals:result.length, note:'Descriptive gross mid-price returns; not execution-adjusted profit. Null samples are not losers.',
  byCaller, signals:result }, null, 2));
