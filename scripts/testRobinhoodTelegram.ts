import {
  config,
} from '../src/config.js';

import {
  sendTelegram,
} from '../src/services/telegram.js';

async function main() {
  console.log(
    '🟣 Testing AlphaOS Robinhood Telegram...',
  );

  await sendTelegram(
    config.adminTelegramId,
    [
      '🟣 <b>ALPHAOS • ROBINHOOD</b>',
      '',
      '<b>Observer is LIVE ✅</b>',
      '',
      'PONS discovery ✅',
      'Contract vetting ✅',
      'Pool verification ✅',
      'Sellability checks ✅',
      'Holder checks ✅',
      '',
      'Robinhood EARLY WATCH alerts are now active.',
      '',
      '<b>No Robinhood auto-trading is enabled.</b>',
    ].join('\n'),
  );

  console.log(
    '✅ Robinhood Telegram test sent.',
  );
}

main().catch((error) => {
  console.error(
    '❌ Telegram test failed:',
    error,
  );

  process.exit(1);
});
