import { supabase } from '../services/supabase.js';
import { runDatabaseWork } from '../services/databaseLoadGovernor.js';

export type AgentDecision = {
  token?: string | null;
  symbol?: string | null;
  agent: string;
  decision: 'AVOID' | 'WATCH' | 'SCALP' | 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  confidence: number;
  inputData?: Record<string, unknown>;
};

const recentAgentDecisions = new Map<string, number>();
const AGENT_DECISION_DEDUP_MS = Math.max(
  5 * 60_000,
  Number(process.env.AGENT_DECISION_DEDUP_MS ?? 30 * 60_000),
);

export async function recordAgentDecision(args: AgentDecision) {
  const token = String(args.token ?? '').trim().toLowerCase();
  const key = [args.agent, token || 'unknown', args.decision, Math.round(args.confidence / 5) * 5]
    .join(':');
  const now = Date.now();
  const prior = recentAgentDecisions.get(key);
  if (prior != null && now - prior < AGENT_DECISION_DEDUP_MS) return;

  const result = await runDatabaseWork('BACKGROUND', () => supabase.from('agent_memory').insert({
    token: args.token ?? null,
    symbol: args.symbol ?? null,
    agent: args.agent,
    decision: args.decision,
    reason: args.reason,
    confidence: args.confidence,
    input_data: args.inputData ?? {},
  }));

  if (!result) return;
  const { error } = result;
  if (error) {
    console.log('recordAgentDecision error:', error);
    return;
  }

  recentAgentDecisions.set(key, now);
  if (recentAgentDecisions.size > 10_000) {
    for (const [candidate, at] of recentAgentDecisions) {
      if (now - at >= AGENT_DECISION_DEDUP_MS) recentAgentDecisions.delete(candidate);
    }
  }
}

export async function updateAgentOutcome(args: {
  token: string;
  outcome: string;
  pnlPercent?: number | null;
  maxGainPercent?: number | null;
  maxDrawdownPercent?: number | null;
}) {
  const { error } = await supabase
    .from('agent_memory')
    .update({
      outcome: args.outcome,
      pnl_percent: args.pnlPercent ?? null,
      max_gain_percent: args.maxGainPercent ?? null,
      max_drawdown_percent: args.maxDrawdownPercent ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('token', args.token)
    .is('reviewed_at', null);

  if (error) {
    console.log('updateAgentOutcome error:', error);
  }
}

export async function getLearningSummary() {
  const { data, error } = await supabase
    .from('agent_memory')
    .select('decision, outcome, pnl_percent, confidence, agent')
    .not('outcome', 'is', null)
    .order('reviewed_at', { ascending: false })
    .limit(100);

  if (error || !data?.length) {
    return {
      total: 0,
      avgPnl: 0,
      winRate: 0,
      bestDecision: null as string | null,
    };
  }

  const total = data.length;
  const wins = data.filter((x) => Number(x.pnl_percent ?? 0) > 0);
  const avgPnl =
    data.reduce((sum, x) => sum + Number(x.pnl_percent ?? 0), 0) / total;

  const decisionStats = new Map<string, { count: number; pnl: number }>();

  for (const row of data) {
    const key = String(row.decision ?? 'UNKNOWN');
    const current = decisionStats.get(key) ?? { count: 0, pnl: 0 };
    current.count += 1;
    current.pnl += Number(row.pnl_percent ?? 0);
    decisionStats.set(key, current);
  }

  const bestDecision =
    [...decisionStats.entries()]
      .map(([decision, value]) => ({
        decision,
        avgPnl: value.pnl / value.count,
      }))
      .sort((a, b) => b.avgPnl - a.avgPnl)[0]?.decision ?? null;

  return {
    total,
    avgPnl,
    winRate: (wins.length / total) * 100,
    bestDecision,
  };
}