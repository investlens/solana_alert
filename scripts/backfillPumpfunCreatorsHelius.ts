/// <reference types="node" />
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

async function fetchPumpfunTxs(limit = 100) {
  if (!HELIUS_API_KEY) throw new Error('Missing HELIUS_API_KEY');

  const url =
    `https://api.helius.xyz/v0/addresses/${PUMPFUN_PROGRAM}/transactions` +
    `?api-key=${HELIUS_API_KEY}&limit=${limit}`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Helius failed: ${res.status} ${text}`);
  }

  return await res.json();
}

function extractMint(tx: any) {
  const tokenTransfers = tx?.tokenTransfers ?? [];

  for (const t of tokenTransfers) {
    if (t?.mint) return t.mint;
  }

  const accountData = tx?.accountData ?? [];
  for (const a of accountData) {
    if (a?.account && String(a.account).endsWith('pump')) {
      return a.account;
    }
  }

  return null;
}

async function saveLaunch(tx: any) {
  const creator = tx?.feePayer ?? null;
  const mint = extractMint(tx);

  if (!mint || !creator) return false;

  const { error } = await supabase.from('creator_launches').upsert(
    {
      creator_wallet: creator,
      token: mint,
      symbol: null,
      name: null,
      launched_at: tx?.timestamp
        ? new Date(tx.timestamp * 1000).toISOString()
        : new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );

  if (error) {
    console.log('save failed:', mint, error.message);
    return false;
  }

  return true;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase env variables');
  }

  console.log('Fetching Pump.fun txs from Helius...');

  const txs = await fetchPumpfunTxs(100);
  console.log(`Fetched ${txs.length} txs`);

  let saved = 0;

  for (const tx of txs) {
    const ok = await saveLaunch(tx);
    if (ok) saved += 1;
  }

  console.log(`Saved ${saved} creator launches`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});