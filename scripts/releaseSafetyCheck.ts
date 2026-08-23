import { config } from '../src/config.js';
import { getAlphaSettings } from '../src/services/settingsService.js';

async function main() {
  const settings = await getAlphaSettings(true);
  const checks = [
    { name: 'Admin trading disabled', ok: config.adminTradingEnabled === false },
    { name: 'Execution mode is paper', ok: settings.executionMode === 'paper' },
    { name: 'Admin auto-buy disabled', ok: settings.adminAutoBuyEnabled === false },
    { name: 'Telegram polling enabled here', ok: process.env.RUN_TELEGRAM_BOT === 'true' },
  ];

  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.name}`);
  }
  console.log('ℹ️ Verify Railway runs exactly one replica for the polling service.');

  if (checks.some(check => !check.ok)) process.exitCode = 1;
}

main().catch(error => {
  console.error('❌ Release safety check could not read runtime settings:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
