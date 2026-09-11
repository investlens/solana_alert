import { getRobinhoodMarketSnapshot } from '../chains/robinhood/market.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';
import { supabase } from '../services/supabase.js';
import { runDatabaseWork } from '../services/databaseLoadGovernor.js';
import { describeBackgroundError } from '../services/backgroundPromiseSafety.js';

const CHECKPOINTS = [900, 1800, 3600] as const;
const POLL_MS = 30_000;
const MAX_LATENESS_SECONDS = 90;
const LIMIT = 40;

type DecisionRow = {
  id: number;
  token_address: string;
  chain: string;
  entry_price: number | string | null;
  created_at: string;
};

type ExistingOutcome = {
  shadow_decision_id: number;
  checkpoint_seconds: number;
  roi: number | string | null;
  peak_roi: number | string | null;
  max_drawdown: number | string | null;
  outcome_status: string;
};

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function currentPrice(row: DecisionRow): Promise<{ price: number | null; source: string }> {
  const chain = String(row.chain || '').toLowerCase();
  if (chain === 'robinhood' || chain === 'pons') {
    const market = await getRobinhoodMarketSnapshot(row.token_address, { priority: 'BACKGROUND', caller: 'shadow_outcome_grader' });
    return { price: positive(market?.priceUsd), source: 'ROBINHOOD_MARKET_SNAPSHOT' };
  }
  if (chain === 'solana') {
    const result = await enrichTokenByMintAddress(row.token_address);
    return { price: positive((result?.pair as { priceUsd?: string | null } | undefined)?.priceUsd), source: 'DEXSCREENER_TOKEN_PAIR' };
  }
  return { price: null, source: 'UNSUPPORTED_CHAIN' };
}

function nextDue(row: DecisionRow, done: Set<number>, now: Date): number | null {
  const age = Math.floor((now.getTime() - new Date(row.created_at).getTime()) / 1000);
  for (const checkpoint of CHECKPOINTS) {
    if (done.has(checkpoint)) continue;
    if (age >= checkpoint && age - checkpoint <= MAX_LATENESS_SECONDS) return checkpoint;
  }
  return null;
}

async function gradeCycle(now = new Date()): Promise<number> {
  const oldest = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const { data: decisions, error } = await supabase.from('shadow_intelligence_decisions')
    .select('id,token_address,chain,entry_price,created_at')
    .not('entry_price', 'is', null).gte('created_at', oldest).order('created_at', { ascending: true }).limit(LIMIT);
  if (error) throw error;
  if (!decisions?.length) return 0;

  const ids = decisions.map(row => Number(row.id));
  const { data: existing, error: existingError } = await supabase.from('shadow_decision_outcomes')
    .select('shadow_decision_id,checkpoint_seconds,roi,peak_roi,max_drawdown,outcome_status').in('shadow_decision_id', ids);
  if (existingError) throw existingError;

  const byDecision = new Map<number, ExistingOutcome[]>();
  for (const row of (existing ?? []) as ExistingOutcome[]) {
    const list = byDecision.get(Number(row.shadow_decision_id)) ?? [];
    list.push(row); byDecision.set(Number(row.shadow_decision_id), list);
  }

  let measured = 0;
  for (const row of decisions as DecisionRow[]) {
    const prior = byDecision.get(Number(row.id)) ?? [];
    const done = new Set(prior.map(item => Number(item.checkpoint_seconds)));
    const due = nextDue(row, done, now);
    if (!due) continue;

    const entry = positive(row.entry_price);
    if (entry == null) continue;

    try {
      const market = await currentPrice(row);
      if (market.price == null) {
        await supabase.from('shadow_decision_outcomes').upsert({
          shadow_decision_id: row.id, checkpoint_seconds: due, outcome_status: 'UNAVAILABLE', outcome_source: market.source, measured_at: now.toISOString(),
        }, { onConflict: 'shadow_decision_id,checkpoint_seconds' });
        continue;
      }

      const roi = ((market.price - entry) / entry) * 100;
      const previousPeaks = prior.map(item => Number(item.peak_roi)).filter(Number.isFinite);
      const peakRoi = Math.max(0, roi, ...previousPeaks);
      const maxDrawdown = peakRoi > roi ? peakRoi - roi : 0;
      const { error: writeError } = await supabase.from('shadow_decision_outcomes').upsert({
        shadow_decision_id: row.id, checkpoint_seconds: due, roi, peak_roi: peakRoi, max_drawdown: maxDrawdown,
        outcome_status: 'MEASURED', outcome_source: market.source, measured_at: now.toISOString(),
      }, { onConflict: 'shadow_decision_id,checkpoint_seconds' });
      if (writeError) throw writeError;
      measured += 1;
      console.log('[ShadowOutcomeGrader] measured', { decisionId: row.id, token: row.token_address, checkpoint: due, roi: Number(roi.toFixed(2)), peakRoi: Number(peakRoi.toFixed(2)) });
    } catch (err) {
      console.warn('[ShadowOutcomeGrader] measurement failed but production continues:', err instanceof Error ? err.message : String(err));
    }
  }
  return measured;
}

export async function runShadowDecisionOutcomeGrader(now = new Date()): Promise<number> {
  return (await runDatabaseWork('BACKGROUND', () => gradeCycle(now))) ?? 0;
}

let started = false;
export function startShadowDecisionOutcomeGrader(): void {
  if (started) return;
  started = true;
  const run = () => void runShadowDecisionOutcomeGrader().catch(error => console.warn(`[ShadowOutcomeGrader] Cycle failed: ${describeBackgroundError(error)}`));
  run();
  setInterval(run, Number(process.env.SHADOW_OUTCOME_GRADER_POLL_MS ?? POLL_MS));
  console.log('[ShadowOutcomeGrader] Started. Checkpoints: 15m, 30m, 1h. Shadow-only; no production actions.');
}
