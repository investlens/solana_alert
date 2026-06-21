import { supabase } from '../services/supabase.js';

export type OpportunityType =
  | 'TOKEN_PREDEX'
  | 'TOKEN_CREATOR'
  | 'TOKEN_WALLET'
  | 'DEX_CONFIRMATION'
  | 'NFT_MISPRICE'
  | 'NFT_OFFER_ARBITRAGE'
  | 'CEX_DEX_ARB'
  | 'PREDICTION_MARKET'
  | 'NEWS_CATALYST';

export type OpportunityStatus =
  | 'NEW'
  | 'WATCHING'
  | 'APPROVED'
  | 'EXECUTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'REVIEWED';

export async function recordOpportunity(args: {
  opportunityType: OpportunityType;
  assetId: string;
  chain?: string | null;
  sourceAgent: string;
  title?: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  expectedProfit?: number | null;
  expectedProfitPercent?: number | null;
  riskScore?: number;
  confidence?: number;
  status?: OpportunityStatus;
  rawData?: Record<string, unknown>;
}) {
  const { data, error } = await supabase
    .from('opportunities')
    .insert({
      opportunity_type: args.opportunityType,
      asset_id: args.assetId,
      chain: args.chain ?? null,
      source_agent: args.sourceAgent,
      title: args.title ?? null,
      entry_price: args.entryPrice ?? null,
      exit_price: args.exitPrice ?? null,
      expected_profit: args.expectedProfit ?? null,
      expected_profit_percent: args.expectedProfitPercent ?? null,
      risk_score: args.riskScore ?? 50,
      confidence: args.confidence ?? 50,
      status: args.status ?? 'NEW',
      raw_data: args.rawData ?? {},
    })
    .select()
    .single();

  if (error) {
    console.log('recordOpportunity error:', error);
    return null;
  }

  console.log('opportunity recorded:', {
    id: data.id,
    type: args.opportunityType,
    asset: args.assetId,
    confidence: args.confidence ?? 50,
  });

  return data;
}

export async function updateOpportunityStatus(args: {
  id: number;
  status: OpportunityStatus;
}) {
  const { error } = await supabase
    .from('opportunities')
    .update({
      status: args.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.id);

  if (error) {
    console.log('updateOpportunityStatus error:', error);
  }
}

export async function getLatestOpportunities(limit = 20) {
  const { data, error } = await supabase
    .from('opportunities')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.log('getLatestOpportunities error:', error);
    return [];
  }

  return data ?? [];
}