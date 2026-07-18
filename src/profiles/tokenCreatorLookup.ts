import { supabase } from '../services/supabase.js';

export async function getCreatorWalletForToken(
  token: string | null | undefined
): Promise<string | null> {
  if (!token) return null;

  const { data, error } = await supabase
    .from('creator_launches')
    .select('creator_wallet')
    .eq('token', token)
    .not('creator_wallet', 'is', null)
    .order('launched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('getCreatorWalletForToken error:', {
      token,
      error: error.message,
    });

    return null;
  }

  return data?.creator_wallet ?? null;
}