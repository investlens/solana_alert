import { supabase } from '../services/supabase.js';

export async function getCreatorWalletForToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;

  const { data, error } = await supabase
    .from('creator_launches')
    .select('creator_wallet')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.log('getCreatorWalletForToken error:', error.message);
    return null;
  }

  return data?.creator_wallet ?? null;
}