import { supabase } from '../services/supabase.js';

export type CreatorReputation = {
  creator_wallet: string;
  total_launches: number;
  successful_launches: number;
  rugs: number;
  best_multiple: number;
  avg_multiple: number;
  trust_score: number;
  last_token: string | null;
};

export async function getCreatorReputation(
  creatorWallet: string | null | undefined
): Promise<CreatorReputation | null> {
  if (!creatorWallet) return null;

  const { data, error } = await supabase
    .from('creator_stats')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .maybeSingle();

  if (error) {
    console.log('getCreatorReputation error:', error);
    return null;
  }

  return data as CreatorReputation | null;
}

export function creatorTrustLabel(score: number) {
  if (score >= 80) return 'PROVEN';
  if (score >= 60) return 'NEUTRAL';
  if (score >= 40) return 'RISKY';
  return 'AVOID';
}