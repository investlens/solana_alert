import 'dotenv/config';
import { supabase } from '../src/services/supabase.js';

type Event = { id: number; asset_id: string; chain: string; lifecycle_action: string; alert_type: string; strategy_key: string | null; confidence: number | string | null; market_cap: number | string | null; fdv: number | string | null; dev_holding_percent: number | string | null; boost_total: number | string | null; risk_evidence: Record<string, unknown> | null; raw_snapshot: Record<string, unknown>; alerted_at: string; valuation_provenance: string | null; liquidity: number | string | null; price_provenance: string | null; burned_percent: number | string | null };
type Outcome = { alert_event_id: number; checkpoint_seconds: number; current_roi: number | string | null; peak_roi: number | string | null; time_to_peak_seconds: number | null; max_drawdown: number | string | null; status: string };
const n = (value: unknown): number | null => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const pct = (part: number, total: number) => total ? `${part}/${total} (${(part / total * 100).toFixed(1)}%)` : '0/0';
const band = (value: number | null, cuts: number[], labels: string[]) => labels[cuts.findIndex(cut => value != null && value < cut)] ?? labels[labels.length - 1];

const hours = Math.max(1, Number(process.argv[2] ?? 24));
const since = new Date(Date.now() - hours * 3_600_000).toISOString();
const { data: eventData, error } = await supabase.from('alpha_alert_events').select('*').gte('alerted_at', since).order('alerted_at');
if (error) throw error;
const events = (eventData ?? []) as Event[];
const ids = events.map(event => event.id);
const outcomes: Outcome[] = [];
for (let offset = 0; offset < ids.length; offset += 500) {
  const page = ids.slice(offset, offset + 500); if (!page.length) continue;
  const result = await supabase.from('alpha_alert_outcomes').select('*').in('alert_event_id', page);
  if (result.error) throw result.error; outcomes.push(...(result.data ?? []) as Outcome[]);
}
const byEvent = new Map<number, Outcome[]>();
for (const outcome of outcomes) byEvent.set(outcome.alert_event_id, [...(byEvent.get(outcome.alert_event_id) ?? []), outcome]);
const entries = events.filter(event => ['CHECK_ENTRY', 'BUY'].includes(event.lifecycle_action));
const exits = events.filter(event => event.lifecycle_action === 'EXIT');
const priorEntry = (exit: Event) => events.some(entry => ['CHECK_ENTRY', 'BUY'].includes(entry.lifecycle_action) && entry.chain === exit.chain && entry.asset_id.toLowerCase() === exit.asset_id.toLowerCase() && entry.alerted_at < exit.alerted_at);
const peak = (event: Event) => Math.max(...(byEvent.get(event.id) ?? []).map(row => n(row.peak_roi) ?? -Infinity));
const measurable = entries.filter(event => Number.isFinite(peak(event)));
const line = (label: string, value: unknown) => console.log(`- ${label}: ${value ?? 'unavailable'}`);

console.log(`ALPHA ALERT OUTCOMES — last ${hours}h\n\nALERT VOLUME`);
for (const action of ['CHECK_ENTRY', 'BUY', 'EXIT']) line(action, events.filter(event => event.lifecycle_action === action).length);
line('standalone internal risks', exits.filter(exit => !priorEntry(exit)).length);
line('critical AVOID', exits.filter(exit => String(exit.risk_evidence?.severity ?? '').toUpperCase() === 'CRITICAL').length);
line('booster events', events.filter(event => n(event.boost_total) != null || n(event.raw_snapshot?.boostIncrement) != null).length);

console.log('\nENTRY PERFORMANCE'); line('count', entries.length); line('measurable count', measurable.length);
for (const target of [5, 10, 20, 50, 100]) line(`hit +${target}%`, pct(measurable.filter(event => peak(event) >= target).length, measurable.length));

const firstHit = (event: Event, target: number) => (byEvent.get(event.id) ?? []).filter(row => (n(row.peak_roi) ?? -Infinity) >= target).sort((a, b) => a.checkpoint_seconds - b.checkpoint_seconds)[0]?.checkpoint_seconds;
const entryExitTimes = exits.flatMap(exit => { const entry = [...entries].reverse().find(item => item.chain === exit.chain && item.asset_id.toLowerCase() === exit.asset_id.toLowerCase() && item.alerted_at < exit.alerted_at); return entry ? [(new Date(exit.alerted_at).getTime() - new Date(entry.alerted_at).getTime()) / 1000] : []; });
console.log('\nTIMING'); line('median time to +10', median(entries.flatMap(event => firstHit(event, 10) ?? []))); line('median time to +20', median(entries.flatMap(event => firstHit(event, 20) ?? []))); line('median time to peak', median(outcomes.flatMap(row => row.time_to_peak_seconds ?? []))); line('median Entry -> Exit', median(entryExitTimes));

function summarize(title: string, key: (event: Event) => string) {
  console.log(`\n${title}`); const groups = new Map<string, Event[]>();
  for (const event of entries) groups.set(key(event), [...(groups.get(key(event)) ?? []), event]);
  for (const [name, rows] of groups) { const measured = rows.filter(row => Number.isFinite(peak(row))); const avgPeak = measured.length ? measured.reduce((sum, row) => sum + peak(row), 0) / measured.length : null; const drawdowns = measured.flatMap(row => (byEvent.get(row.id) ?? []).map(outcome => n(outcome.max_drawdown)).filter((v): v is number => v != null)); line(name, `count=${rows.length} avgPeak=${avgPeak?.toFixed(1) ?? 'n/a'} hit20=${pct(measured.filter(row => peak(row) >= 20).length, measured.length)} drawdown=${median(drawdowns)?.toFixed(1) ?? 'n/a'}`); }
}
summarize('CONFIDENCE', event => band(n(event.confidence), [60, 70, 80, 90], ['<60', '60-69', '70-79', '80-89', '90+']));
summarize('STRATEGY', event => event.strategy_key ?? 'UNKNOWN');
summarize('VALUATION BANDS', event => band(n(event.market_cap) ?? n(event.fdv), [5_000, 10_000, 25_000], ['<5K', '5-10K', '10-25K', '25K+']));
summarize('DEV HOLDING BANDS', event => band(n(event.dev_holding_percent), [0.000001, 5, 10, 20], ['0', '0-5', '5-10', '10-20', '>20']));
summarize('BOOST', event => (n(event.boost_total) ?? 0) >= 200 ? '>=200' : '<200');

console.log('\nDATA COMPLETENESS');
const complete = (predicate: (event: Event) => boolean) => pct(events.filter(predicate).length, events.length);
line('identity', complete(event => Boolean(event.asset_id && (event.raw_snapshot?.symbol || event.raw_snapshot?.name))));
line('valuation', complete(event => n(event.market_cap) != null || n(event.fdv) != null)); line('liquidity', complete(event => n(event.liquidity) != null));
line('price provenance', complete(event => Boolean(event.price_provenance))); line('dev holding', complete(event => n(event.dev_holding_percent) != null));
line('burn', complete(event => n(event.burned_percent) != null)); line('outcome checkpoints', pct(new Set(outcomes.map(outcome => outcome.alert_event_id)).size, events.length));
