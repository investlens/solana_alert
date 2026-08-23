import { supabase } from './supabase.js';

export type WatchedOpportunity = {
  id: number;
  telegram_id: string;
  opportunity_id: number;
  created_at: string;
  updated_at: string;
  opportunities?: Record<string, unknown> | null;
};

export async function trackOpportunity(args: {
  telegramId: string;
  opportunityId: number;
}): Promise<void> {
  const { error } = await supabase
    .from('user_opportunity_watchlist')
    .upsert(
      {
        telegram_id: args.telegramId,
        opportunity_id: args.opportunityId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id,opportunity_id' },
    );

  if (error) throw error;
}

export async function untrackOpportunity(args: {
  telegramId: string;
  opportunityId: number;
}): Promise<void> {
  const { error } = await supabase
    .from('user_opportunity_watchlist')
    .delete()
    .eq('telegram_id', args.telegramId)
    .eq('opportunity_id', args.opportunityId);

  if (error) throw error;
}

export async function isOpportunityTracked(args: {
  telegramId: string;
  opportunityId: number;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_opportunity_watchlist')
    .select('id')
    .eq('telegram_id', args.telegramId)
    .eq('opportunity_id', args.opportunityId)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

export async function getTrackedOpportunities(
  telegramId: string,
  limit = 25,
): Promise<WatchedOpportunity[]> {
  const { data, error } = await supabase
    .from('user_opportunity_watchlist')
    .select(`
      id,
      telegram_id,
      opportunity_id,
      created_at,
      updated_at,
      opportunities (
        id,
        asset_id,
        chain,
        strategy_key,
        recommended_action,
        status,
        title,
        confidence,
        risk_score,
        last_observed_at,
        updated_at
      )
    `)
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (error) throw error;
  return (data ?? []) as unknown as WatchedOpportunity[];
}
