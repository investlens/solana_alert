import { supabase } from '../services/supabase.js';
import type { AlphaSignal } from '../engines/alphaFeed.js';

function signalKey(signal: Pick<AlphaSignal, 'type' | 'token'>) {
  return `${signal.type}:${signal.token}`;
}

export async function upsertAlphaSignal(signal: AlphaSignal) {
  const { error } = await supabase.from('alpha_signals').upsert(
    {
      signal_key: signalKey(signal),
      type: signal.type,
      title: signal.title,
      symbol: signal.symbol,
      token: signal.token,
      score: signal.score ?? null,
      conviction: signal.conviction,
      summary: signal.summary,
      dex_url: signal.dexUrl ?? null,
      buy_url: signal.buyUrl ?? null,
      alert_price: signal.alertPrice ?? null,
      current_price: signal.currentPrice ?? null,
      high_after_alert: signal.highAfterAlert ?? null,
      roi_now: signal.roiNow ?? null,
      roi_high: signal.roiHigh ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'signal_key' }
  );

  if (error) throw error;
}

export async function fetchSignalsByType(
  type: string,
  limit = 10
) {
  const { data, error } = await supabase
    .from('alpha_signals')
    .select('*')
    .eq('type', type)
    .order('created_at', { ascending:false })
    .limit(limit);

  if(error) throw error;

  return data ?? [];
}

export async function fetchLatestStoredSignals(limit = 10) {
  const { data, error } = await supabase
    .from('alpha_signals')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchBestStoredSignals(limit = 10) {
  const { data, error } = await supabase
    .from('alpha_signals')
    .select('*')
    .not('roi_high', 'is', null)
    .order('roi_high', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}