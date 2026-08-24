import { supabase } from './supabase.js';

const INDEPENDENT_CRITICAL_REASONS = new Set([
  'LIQUIDITY_COLLAPSE', 'BUNDLE_SELL', 'CREATOR_CONCENTRATION',
  'SINGLE_HOLDER_CONCENTRATION', 'TOP_5_HOLDER_CONCENTRATION',
  'TOP_10_HOLDER_CONCENTRATION', 'RAPID_HOLDER_CONCENTRATION',
]);

export function criticalAvoidReason(raw: Record<string, unknown> | null): string | null {
  const evidence = raw?.emergencyExit;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const row = evidence as Record<string, unknown>;
  const reason = String(row.reason ?? '').toUpperCase();
  return String(row.severity ?? '').toUpperCase() === 'CRITICAL' && INDEPENDENT_CRITICAL_REASONS.has(reason)
    ? reason : null;
}

export async function userHasExitRelevance(args: {
  telegramId: string; assetId: string; chain: string | null; opportunityId: number;
}): Promise<boolean> {
  const chain = String(args.chain ?? '').toLowerCase();
  const [prior, watched, walletActivity] = await Promise.all([
    supabase.from('opportunity_deliveries')
      .select('id,opportunities!inner(asset_id,chain)')
      .eq('telegram_id', args.telegramId).eq('delivery_channel', 'telegram')
      .in('recommended_action', ['CHECK_ENTRY', 'BUY'])
      .contains('metadata', { state: 'DELIVERED' })
      .ilike('opportunities.asset_id', args.assetId).eq('opportunities.chain', chain).limit(1),
    supabase.from('user_opportunity_watchlist')
      .select('id,opportunities!inner(asset_id,chain)')
      .eq('telegram_id', args.telegramId)
      .ilike('opportunities.asset_id', args.assetId).eq('opportunities.chain', chain).limit(1),
    supabase.from('wallet_activity_deliveries')
      .select('id').eq('telegram_id', args.telegramId)
      .ilike('token_address', args.assetId).limit(1),
  ]);
  if (prior.error) throw prior.error;
  if (watched.error) throw watched.error;
  if (walletActivity.error) throw walletActivity.error;
  return Boolean(prior.data?.length || watched.data?.length || walletActivity.data?.length);
}

export function shouldDeliverExit(args: { action: string; relevant: boolean; criticalReason: string | null }): boolean {
  return args.action !== 'EXIT' || args.relevant || args.criticalReason != null;
}

export const EXISTING_CRITICAL_AVOID_REASONS = [...INDEPENDENT_CRITICAL_REASONS];
