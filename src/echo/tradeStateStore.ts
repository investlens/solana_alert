/** Compare-and-swap state transitions for a reserved Echo trade.
 * Uses the database row state as the concurrency barrier; no signing or broadcasting.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { transitionEchoTrade, type EchoTradeEvent, type EchoTradeState } from './manualTradeLifecycle.js';

export async function advanceEchoTradeState(
  client: SupabaseClient,
  executionWallet: string,
  mint: string,
  expectedState: EchoTradeState,
  event: EchoTradeEvent,
): Promise<{ advanced: true; state: EchoTradeState } | { advanced: false; reason: string }> {
  const transition = transitionEchoTrade(expectedState, event);
  if (!transition.allowed) return { advanced: false, reason: transition.reason };
  if (!executionWallet || !mint) return { advanced: false, reason: 'INVALID_RESERVATION_KEY' };
  try {
    const { data, error } = await client.from('echo_live_buy_intents')
      .update({ state: transition.next, updated_at: new Date().toISOString() })
      .eq('execution_wallet', executionWallet)
      .eq('mint', mint)
      .eq('state', expectedState)
      .select('state');
    if (error) return { advanced: false, reason: 'STORAGE_UNAVAILABLE' };
    if (!Array.isArray(data) || data.length !== 1 || data[0]?.state !== transition.next)
      return { advanced: false, reason: 'STATE_CONFLICT' };
    return { advanced: true, state: transition.next };
  } catch {
    return { advanced: false, reason: 'STORAGE_UNAVAILABLE' };
  }
}
