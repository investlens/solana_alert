import { supabase } from './supabase.js';

export type TokenBundleEvidence = {
  status: 'VERIFIED' | 'UNKNOWN';
  level: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  score: number | null;
  connectedWalletCount: number | null;
  connectedSupplyPct: number | null;
  evaluatedAt: string | null;
  source: string | null;
  reason: string | null;
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bundleReason(checks: unknown): string | null {
  if (!Array.isArray(checks)) return null;
  const row = checks.find(item => item && typeof item === 'object' && (item as Record<string, unknown>).key === 'ROBINHOOD_BUNDLE') as Record<string, unknown> | undefined;
  return typeof row?.detail === 'string' ? row.detail : null;
}

export async function getLatestRobinhoodBundleEvidence(tokenAddress: string): Promise<TokenBundleEvidence> {
  const { data, error } = await supabase
    .from('robinhood_dex_paid_security_snapshots')
    .select('evaluated_at,bundle_level,bundle_score,bundle_evidence_available,bundle_connected_wallet_count,bundle_connected_supply_pct,checks,source')
    .ilike('token_address', tokenAddress)
    .order('evaluated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { status: 'UNKNOWN', level: null, score: null, connectedWalletCount: null, connectedSupplyPct: null,
      evaluatedAt: null, source: null, reason: error ? 'bundle evidence lookup unavailable' : 'no bundle evidence captured yet' };
  }

  const level = String(data.bundle_level ?? '').toUpperCase();
  const verified = data.bundle_evidence_available === true && ['LOW', 'MEDIUM', 'HIGH'].includes(level);
  if (!verified) {
    return { status: 'UNKNOWN', level: null, score: null, connectedWalletCount: null, connectedSupplyPct: null,
      evaluatedAt: String(data.evaluated_at ?? '') || null, source: String(data.source ?? '') || null,
      reason: bundleReason(data.checks) ?? 'bundle analysis has not produced verified evidence' };
  }

  return {
    status: 'VERIFIED',
    level: level as 'LOW' | 'MEDIUM' | 'HIGH',
    score: finite(data.bundle_score),
    connectedWalletCount: finite(data.bundle_connected_wallet_count),
    connectedSupplyPct: finite(data.bundle_connected_supply_pct),
    evaluatedAt: String(data.evaluated_at ?? '') || null,
    source: String(data.source ?? '') || null,
    reason: null,
  };
}
