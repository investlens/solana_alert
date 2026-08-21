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
  const isEntry =
    args.state === 'ENTRY_WINDOW';

  const title =
    isEntry
      ? '⚡ ALPHAOS · ENTRY WINDOW'
      : '🔥 ALPHAOS · FAST BREAKOUT';

  const decision =
    isEntry
      ? '🟢 ACTION: CHECK & BUY'
      : '🟠 ACTION: VERIFY · DO NOT CHASE';

  const instruction =
    isEntry
      ? 'Momentum confirmation detected. Check the live token now. If the move is still intact, this is the manual entry window.'
      : 'Strong breakout detected. Price may already be moving fast. Check the live token before entering. Skip if extended.';

  return [
    title,
    '',
    `<b>${decision}</b>`,
    '',
    instruction,
    '',
    `ROI NOW     <b>${args.roi >= 0 ? '+' : ''}${args.roi.toFixed(2)}%</b>`,
    `MOMENTUM    <b>${
      args.change == null
        ? 'N/A'
        : `${args.change >= 0 ? '+' : ''}${args.change.toFixed(2)}%`
    }</b>`,
    `AGE         <b>${args.elapsedSec}s</b>`,
    '',
    'TOKEN',
    `<code>${args.token}</code>`,
    '',
    `🧠 ${args.reason}`,
    '',
    isEntry
      ? '⚠️ Manual mode · verify live price before entry.'
      : '⚠️ Do not buy purely because of this alert if price has already extended.',
  ].join('\n');
}

function buildButtons(
  token: string,
) {
  return {
    inline_keyboard: [
      [
        {
          text: '🔎 OPEN TOKEN',
          url: `https://robinhoodchain.blockscout.com/token/${token}`,
        },
      ],
    ],
  };
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

                reply_markup:
                  buildButtons(
                    args.token,
                  ),
              }),
          },
        );

      if (!response.ok) {
        const body =
          await response.text();

        console.error(
          '[PonsAlphaTelegram] Send failed:',
          {
            telegramId:
              user.telegram_id,

            status:
              response.status,

            body,
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
