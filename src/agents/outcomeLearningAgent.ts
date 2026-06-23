import { supabase } from '../services/supabase.js';
import { enrichTokenByMintAddress } from '../services/dexscreener.js';

type AlertOutcomeRow = {
  token: string;
  symbol: string | null;
  alert_market_cap: number | null;
  peak_market_cap: number | null;
};

function num(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getOutcome(peakMarketCap: number) {
  if (peakMarketCap >= 1_000_000) return 'HIT_1M';
  if (peakMarketCap >= 500_000) return 'HIT_500K';
  if (peakMarketCap >= 100_000) return 'HIT_100K';
  return 'TRACKING';
}

export async function runOutcomeLearningAgent() {
  const { data, error } = await supabase
    .from('alert_outcomes')
    .select('token, symbol, alert_market_cap, peak_market_cap')
    .order('updated_at', { ascending: true })
    .limit(10);

  if (error) {
    console.log('outcome learning fetch error:', error);
    return;
  }

  const rows = (data ?? []) as AlertOutcomeRow[];

  if (!rows.length) {
    console.log('outcome learning: no alerts to track');
    return;
  }

  console.log('outcome learning checking:', rows.length);

  for (const row of rows) {
    try {
      const enriched = await enrichTokenByMintAddress(row.token);
      const marketCap = num(enriched?.result?.marketCap);

      if (!marketCap) {
        await supabase
          .from('alert_outcomes')
          .update({ updated_at: new Date().toISOString() })
          .eq('token', row.token);

        continue;
      }

      const previousPeak = num(row.peak_market_cap);
      const peakMarketCap = Math.max(previousPeak, marketCap);
      const alertMarketCap = num(row.alert_market_cap);

      const roiPercent =
        alertMarketCap > 0
          ? ((peakMarketCap - alertMarketCap) / alertMarketCap) * 100
          : null;

      const outcome = getOutcome(peakMarketCap);

      const { error: updateError } = await supabase
        .from('alert_outcomes')
        .update({
          peak_market_cap: peakMarketCap,
          roi_percent: roiPercent,
          outcome,
          updated_at: new Date().toISOString(),
        })
        .eq('token', row.token);

      if (updateError) {
        console.log('outcome learning update error:', {
          token: row.token,
          error: updateError,
        });
        continue;
      }

      console.log('outcome learning updated:', {
        token: row.token,
        symbol: row.symbol,
        marketCap,
        peakMarketCap,
        roiPercent,
        outcome,
      });
    } catch (err) {
      console.log('outcome learning token error:', {
        token: row.token,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}