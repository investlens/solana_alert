/*
 * AlphaOS legacy PONS Telegram compatibility adapter.
 *
 * PONS opportunity delivery is now handled centrally by
 * opportunityDeliveryService via OPPORTUNITY_ACTIONABLE.
 *
 * This adapter intentionally sends nothing. It remains
 * temporarily so the live tracker does not require a risky
 * same-day structural rewrite.
 */

type PonsAlertState =
  | 'ENTRY_WINDOW'
  | 'FAST_BREAKOUT';

export async function broadcastPonsAlphaAlert(
  args: {
    state: PonsAlertState;
    token: string;
    roi: number;
    change: number | null;
    elapsedSec: number;
    reason: string;
  },
): Promise<number> {
  console.log(
    '[PonsAlphaTelegram] Legacy direct broadcast suppressed; unified opportunity delivery active.',
    {
      token:
        args.token,

      state:
        args.state,
    },
  );

  return 0;
}
