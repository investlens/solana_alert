/**
 * Offline AlphaOS Echo paper-stop replay. No network, no Telegram, no trading.
 * Usage: npx tsx scripts/replayEchoPaperStops.ts observations.jsonl
 * JSONL schema: {"caller":"Croakie","signature":"<base58 tx signature>",
 * "mint":"<mint>","deliveryAt":1792000000,"observedAt":1792000005,
 * "priceUsd":0.000004,"liquidityUsd":25000}
 * All samples for a signal must be from the same quoted token/pool and unit.
 */
import { readFile } from 'node:fs/promises';
import { openPaperStop, updatePaperStop } from '../src/echo/signals.js';
type Point = { caller: string; signature: string; mint: string; deliveryAt: number;
  observedAt: number; priceUsd: number; liquidityUsd?: number };
const path = process.argv[2];
if (!path) throw new Error('Local observations.jsonl required');
const raw = (await readFile(path, 'utf8')).split(/\r?\n/).filter(Boolean);
const groups = new Map<string, Point[]>();
let invalid = 0;
for (const line of raw) {
  try {
    const p = JSON.parse(line) as Point;
    if (typeof p.caller !== 'string' || !p.caller || typeof p.mint !== 'string' ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(p.signature) ||
        !Number.isFinite(p.deliveryAt) || !Number.isFinite(p.observedAt) ||
        !Number.isFinite(p.priceUsd) || p.priceUsd <= 0 || p.observedAt < p.deliveryAt) { invalid++; continue; }
    const key = [p.caller, p.signature, p.mint, p.deliveryAt].join(':');
    groups.set(key, [...(groups.get(key) || []), p]);
  } catch { invalid++; }
}
const results = [];
for (const points of groups.values()) {
  points.sort((a,b) => a.observedAt - b.observedAt);
  const first = points[0];
  const entryPoint = points.find(x => x.observedAt <= first.deliveryAt + 60);
  if (!entryPoint || points.length < 2) {
    results.push({ caller:first.caller,signature:first.signature,mint:first.mint,status:'UNSCORED_INSUFFICIENT_PRICES' });
    continue;
  }
  const entry = entryPoint.priceUsd;
  let position = openPaperStop(entry);
  let exitPrice: number | null = null, exitAt: number | null = null, peakPrice = entry;
  for (const p of points.filter(p => p.observedAt >= entryPoint.observedAt)) {
    // Existing function checks the previously known stop BEFORE updating the peak.
    // If price gaps through the stop, exit at this observed price, not the old stop.
    const updated = updatePaperStop(position,p.priceUsd);
    peakPrice = Math.max(peakPrice,p.priceUsd);
    if (updated.closed) { exitPrice=p.priceUsd; exitAt=p.observedAt; break; }
    position=updated;
  }
  const last = points[points.length-1];
  const pct = (p:number) => Math.round((p/entry-1)*10000)/100;
  results.push({ caller:first.caller,signature:first.signature,mint:first.mint,
    status:exitPrice===null?'OPEN_OR_CENSORED':'PAPER_EXIT_OBSERVED',
    entryAt:entryPoint.observedAt,entryPriceUsd:entry,peakObservedReturnPct:pct(peakPrice),
    paperExitAt:exitAt,paperExitReturnPct:exitPrice===null?null:pct(exitPrice),
    lastObservedReturnPct:pct(last.priceUsd),lastObservedAt:last.observedAt,
    samples:points.length,
    caveat:'Observed-price, gross and sampled replay; execution fees, latency, route and actual slippage not validated.' });
}
const scored = results.filter(x => x.status==='PAPER_EXIT_OBSERVED');
const summary = [...new Set(results.map(x=>x.caller))].sort().map(caller=>{
  const items=scored.filter(x=>x.caller===caller);
  const returns=items.map(x=>x.paperExitReturnPct).filter((x):x is number=>x!==null);
  const sorted=returns.slice().sort((a,b)=>a-b);
  const median = sorted.length?(sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2):null;
  return {caller,signals:results.filter(x=>x.caller===caller).length,observedStopExits:items.length,
    positiveExits:returns.filter(x=>x>0).length,winRate:returns.length?returns.filter(x=>x>0).length/returns.length:null,
    medianGrossStopReturnPct:median};
});
console.log(JSON.stringify({schema:'alphaos.echo.paper-stop-replay.v1',invalidInputRows:invalid,
  uniqueSignals:groups.size, scoredExits:scored.length, summary, results},null,2));
