import {
  config,
} from '../../../config.js';

import {
  sendTelegram,
} from '../../../services/telegram.js';

import {
  scanRobinhoodDevMovement,
} from './devMovementScanner.js';
import { buildCreatorNotification } from '../../../ui/alphaNotificationPresets.js';


const DEV_WATCH_DELAYS_MS =
  [
    10_000,
    30_000,
    60_000,
  ] as const;


const activeWatches =
  new Set<string>();


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


function sleep(
  ms: number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        ms,
      );
    },
  );
}


function buildWarningMessage(args: {
  symbol: string;
  tokenAddress: string;
  transferCount: number;
  destinations: string[];
}): string {
  return buildCreatorNotification({
    symbol: args.symbol,
    address: args.tokenAddress,
    risk: true,
    transferredAmount: args.transferCount,
    reason: args.destinations.length
      ? `Developer tokens moved after alert toward ${args.destinations[0]}.`
      : 'Developer tokens moved after the AlphaOS alert.',
  });
}


export function startPostAlertDevWatch(args: {
  tokenAddress: string;
  symbol: string;
}): void {
  const tokenKey =
    normalize(
      args.tokenAddress,
    );

  if (
    activeWatches.has(
      tokenKey,
    )
  ) {
    return;
  }

  activeWatches.add(
    tokenKey,
  );


  void (async () => {
    try {
      let previousDelay =
        0;

      for (
        const delay
        of DEV_WATCH_DELAYS_MS
      ) {
        const waitTime =
          delay -
          previousDelay;

        previousDelay =
          delay;

        await sleep(
          waitTime,
        );


        const movement =
          await scanRobinhoodDevMovement(
            args.tokenAddress,
          );


        if (
          movement.moved
        ) {
          console.log(
            '[RobinhoodDevWatch] DEV MOVEMENT detected after alert:',
            {
              symbol:
                args.symbol,

              token:
                args.tokenAddress,

              delayMs:
                delay,

              transfers:
                movement.transferCount,

              destinations:
                movement.destinations,
            },
          );


          const message =
            buildWarningMessage({
              symbol:
                args.symbol,

              tokenAddress:
                args.tokenAddress,

              transferCount:
                movement.transferCount,

              destinations:
                movement.destinations,
            });


          await sendTelegram(
            config.adminTelegramId,
            message,
          );


          return;
        }


        console.log(
          '[RobinhoodDevWatch] Dev clean:',
          {
            symbol:
              args.symbol,

            token:
              args.tokenAddress,

            checkpointSeconds:
              delay / 1000,
          },
        );
      }

    } catch (error) {
      console.error(
        '[RobinhoodDevWatch] Watch failed:',
        {
          token:
            args.tokenAddress,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
      );
    } finally {
      activeWatches.delete(
        tokenKey,
      );
    }
  })();
}
