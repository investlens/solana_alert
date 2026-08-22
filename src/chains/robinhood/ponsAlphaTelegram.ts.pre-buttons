import {
  config,
} from '../../config.js';

import {
  getDeliverableUsers,
} from '../../core/delivery.js';

type PonsAlertState =
  | 'ENTRY_WINDOW'
  | 'FAST_BREAKOUT';

function buildMessage(args: {
  state: PonsAlertState;
  token: string;
  roi: number;
  change: number | null;
  elapsedSec: number;
  reason: string;
}): string {
  const title =
    args.state === 'ENTRY_WINDOW'
      ? '⚡ ALPHAOS · PONS ENTRY WINDOW'
      : '🔥 ALPHAOS · PONS FAST BREAKOUT';

  const action =
    args.state === 'ENTRY_WINDOW'
      ? 'MANUAL ENTRY SETUP'
      : 'STRONG MOMENTUM · VERIFY BEFORE ENTRY';

  return [
    title,
    '',
    `<b>${action}</b>`,
    '',
    `ROI: <b>${args.roi >= 0 ? '+' : ''}${args.roi.toFixed(2)}%</b>`,
    `Momentum: <b>${
      args.change == null
        ? 'N/A'
        : `${args.change >= 0 ? '+' : ''}${args.change.toFixed(2)}%`
    }</b>`,
    `Age: <b>${args.elapsedSec}s</b>`,
    '',
    `Token:`,
    `<code>${args.token}</code>`,
    '',
    `🧠 ${args.reason}`,
    '',
    '⚠️ Manual mode: verify current price before buying. Do not chase an extended move.',
  ].join('\n');
}

export async function broadcastPonsAlphaAlert(args: {
  state: PonsAlertState;
  token: string;
  roi: number;
  change: number | null;
  elapsedSec: number;
  reason: string;
}): Promise<number> {
  const users =
    await getDeliverableUsers();

  const message =
    buildMessage(args);

  let delivered = 0;

  for (const user of users) {
    try {
      const response =
        await fetch(
          `https://api.telegram.org/bot${config.botToken}/sendMessage`,
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify({
                chat_id:
                  user.telegram_id,

                text:
                  message,

                parse_mode:
                  'HTML',

                disable_web_page_preview:
                  true,
              }),
          },
        );

      if (!response.ok) {
        console.error(
          '[PonsAlphaTelegram] Send failed:',
          {
            telegramId:
              user.telegram_id,

            status:
              response.status,
          },
        );

        continue;
      }

      delivered += 1;
    } catch (error) {
      console.error(
        '[PonsAlphaTelegram] Send error:',
        {
          telegramId:
            user.telegram_id,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    }
  }

  console.log(
    '[PonsAlphaTelegram] Broadcast complete:',
    {
      token:
        args.token,

      state:
        args.state,

      delivered,
    },
  );

  return delivered;
}
