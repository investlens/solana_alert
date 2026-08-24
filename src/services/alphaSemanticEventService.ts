import { supabase } from './supabase.js';

export type AlphaSemanticEventType = 'DEX_PAID' | 'BOOST' | 'VOLUME_SURGE' | 'BUILDING' | 'CONFIRMED' | 'RUNNER' | 'COOLING' | 'WEAKENING' | 'DANGER' | 'DEV_TRANSFER' | 'DEV_SELL' | 'DEV_BURN' | 'LIQUIDITY_RISK' | 'WALLET_CLUSTER';
export async function persistAlphaSemanticEvent(args: {
  identity: string; type: AlphaSemanticEventType; assetId: string; chain: string;
  intelligenceState?: string | null; strategyKey?: string | null; symbol?: string | null;
  rawSnapshot: Record<string, unknown>; alertedAt?: string;
}): Promise<boolean> {
  const alertedAt = args.alertedAt ?? new Date().toISOString();
  const { data, error } = await supabase.from('alpha_alert_events').upsert({
    event_identity: `v2:${args.type}:${args.identity}`, opportunity_id: null,
    asset_id: args.assetId, chain: args.chain.toLowerCase(), strategy_key: args.strategyKey ?? null,
    lifecycle_action: 'OBSERVE', lifecycle_state: args.intelligenceState ?? 'EVENT',
    alert_type: args.type, semantic_event_type: args.type, intelligence_state: args.intelligenceState ?? null,
    symbol: args.symbol ?? null, chart_available: Boolean(args.rawSnapshot.chartUrl),
    raw_snapshot: structuredClone(args.rawSnapshot), alerted_at: alertedAt,
  }, { onConflict: 'event_identity', ignoreDuplicates: true }).select('id').maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
