const fs = await import('node:fs/promises');

/**
 * Production-only compatibility patch.
 *
 * Robinhood Blockscout currently returns HTTP 403 from Railway. The wallet
 * watcher already contains a bounded live-block fallback, but main.ts called the
 * explorer-only entry point and the explorer swallowed per-wallet failures.
 * Patch those two wiring points before startup imports main.ts so production can
 * use the existing low-load fallback without duplicating scanners.
 */
async function installRobinhoodWalletFallback(): Promise<void> {
  if (String(process.env.ROBINHOOD_WALLET_WATCH_ENABLED ?? 'false').toLowerCase() !== 'true') return;

  const watcherPath = new URL('./chains/robinhood/robinhoodWalletWatcher.ts', import.meta.url);
  let watcher = await fs.readFile(watcherPath, 'utf8');

  const scannedMarker = '  const scannedWallets: Address[] = [];\n\n  for (const wallet of wallets) {';
  const scannedReplacement = '  const scannedWallets: Address[] = [];\n  let failedWalletPolls = 0;\n\n  for (const wallet of wallets) {';
  const catchMarker = "    } catch (error) {\n      console.warn('[RobinhoodWalletExplorer] wallet poll failed', {";
  const catchReplacement = "    } catch (error) {\n      failedWalletPolls += 1;\n      console.warn('[RobinhoodWalletExplorer] wallet poll failed', {";
  const returnMarker = '  return { events, checkpointBlocks, wallets: scannedWallets };\n}\n\n\nconst LIVE_BLOCK_LOOKBACK';
  const returnReplacement = "  if (wallets.length > 0 && failedWalletPolls === wallets.length) {\n    throw new Error('Robinhood wallet explorer unavailable for every active wallet');\n  }\n\n  return { events, checkpointBlocks, wallets: scannedWallets };\n}\n\n\nconst LIVE_BLOCK_LOOKBACK";

  if (!watcher.includes(scannedMarker) || !watcher.includes(catchMarker) || !watcher.includes(returnMarker)) {
    throw new Error('[ProductionStartup] Wallet explorer fallback markers changed; refusing unsafe patch.');
  }
  watcher = watcher
    .replace(scannedMarker, scannedReplacement)
    .replace(catchMarker, catchReplacement)
    .replace(returnMarker, returnReplacement);
  await fs.writeFile(watcherPath, watcher, 'utf8');

  const mainPath = new URL('./main.ts', import.meta.url);
  let main = await fs.readFile(mainPath, 'utf8');
  const importMarker = "import {\n  pollRobinhoodTrackedWalletsExplorer,\n} from './chains/robinhood/robinhoodWalletWatcher.js';";
  const importReplacement = "import {\n  pollRobinhoodTrackedWalletsLean,\n} from './chains/robinhood/robinhoodWalletWatcher.js';";
  const callMarker = 'await pollRobinhoodTrackedWalletsExplorer(deliverTrackedWalletActivity);';
  const callReplacement = 'await pollRobinhoodTrackedWalletsLean(deliverTrackedWalletActivity);';

  if (!main.includes(importMarker) || !main.includes(callMarker)) {
    throw new Error('[ProductionStartup] Wallet watcher main wiring changed; refusing unsafe patch.');
  }
  main = main.replace(importMarker, importReplacement).replace(callMarker, callReplacement);
  await fs.writeFile(mainPath, main, 'utf8');
  console.log('[ProductionStartup] Robinhood wallet explorer -> bounded RPC fallback enabled.');
}

await installRobinhoodWalletFallback();
await import('./startup.js');
