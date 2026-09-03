import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { normalizeTrackedWalletLabel } from '../src/services/trackedWalletService.js';
import { buildWalletActivityMessage } from '../src/services/walletActivityDeliveryService.js';
import { buildWalletIntelligenceProfile } from '../src/services/walletIntelligenceService.js';
import { renderWalletIntelligence } from '../src/bot/walletTracking.js';
import type { WalletWatchEvent } from '../src/core/walletWatcher.js';

const wallet = '0x98469ccf8b1807870f61557aea293adf959bc212';
const token = '0x1111111111111111111111111111111111111111';

test('wallet labels are optional, normalized, bounded and safe for Telegram rendering', () => {
  assert.equal(normalizeTrackedWalletLabel('  Project\nX\u0000 Dev  '), 'Project X Dev');
  assert.equal(normalizeTrackedWalletLabel('   '), null);
  assert.equal([...normalizeTrackedWalletLabel('x'.repeat(100))!].length, 64);
});

test('tracked-wallet alerts use the custom name and retain address fallback', () => {
  const event = { kind: 'launch', chain: 'robinhood', wallet, signature: `0x${'2'.repeat(64)}`,
    tokenMint: token, tokenSymbol: 'XYZ', tokenName: 'Token XYZ', type: 'verified PONS launch' } as WalletWatchEvent;
  const named = buildWalletActivityMessage({ event, label: '<Project X Dev>' });
  assert.match(named, /Wallet\s+<b>&lt;PROJECT X DEV&gt;<\/b>/);
  assert.doesNotMatch(named, /<Project X Dev>/);
  const unnamed = buildWalletActivityMessage({ event, label: null });
  assert.match(unnamed, /0X9846…9BC212/);
});

test('wallet intelligence presents the custom name without changing intelligence inputs', () => {
  const profile = buildWalletIntelligenceProfile({ walletAddress: wallet, launches: [], shadows: [], flows: [] });
  const rendered = renderWalletIntelligence(profile, 'Copper Inu Dev');
  assert.match(rendered, /Copper Inu Dev/);
  assert.equal(profile.wallet, wallet);
  assert.equal(profile.launches.total, 0);
});

test('add, skip, rename and remove-name UX preserve canonical tracked-wallet identity', async () => {
  const ui = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  const service = await readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8');
  const baseMigration = await readFile(new URL('../supabase/migrations/20260823131500_user_tracked_wallets.sql', import.meta.url), 'utf8');
  const labelMigration = await readFile(new URL('../supabase/migrations/20260902160000_tracked_wallet_label_constraints.sql', import.meta.url), 'utf8');

  assert.match(ui, /Name this wallet \(optional\)/);
  assert.match(ui, /WALLET_NAME_SKIP/);
  assert.match(ui, /WALLET_RENAME_/);
  assert.match(ui, /Remove name/);
  assert.match(ui, /✏️ Rename/);
  assert.match(service, /update\(\{ label: normalizeTrackedWalletLabel\(args\.label\), updated_at:/);
  assert.match(service, /\.eq\('id', args\.id\)[\s\S]*\.eq\('telegram_id', args\.telegramId\)/);
  assert.doesNotMatch(service, /updateTrackedWalletLabel[\s\S]{0,500}(wallet_address|chain|is_active|alerts_enabled):/);
  assert.match(baseMigration, /unique\s*\(\s*telegram_id,\s*chain,\s*wallet_address\s*\)/s);
  assert.doesNotMatch(labelMigration, /unique[\s\S]*label/i);
  assert.match(labelMigration, /char_length\(label\) between 1 and 64/);
});

test('custom wallet names do not introduce Proven Dev auto-tracking', async () => {
  const changedSources = await Promise.all([
    readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/trackedWalletService.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(changedSources.join('\n'), /COPPERINU|CASHCOW|proven_creators|Proven Dev/);
});
