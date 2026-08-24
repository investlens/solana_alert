import 'dotenv/config';
import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { supabase } from '../src/services/supabase.js';

const [walletsResult, cursorsResult, deliveriesResult] = await Promise.all([
  supabase.from('user_tracked_wallets').select('telegram_id,wallet_address,chain,is_active,alerts_enabled,created_at,updated_at'),
  supabase.from('wallet_monitor_cursors').select('chain,wallet_address,last_processed_block,created_at,updated_at'),
  supabase.from('wallet_activity_deliveries').select('telegram_id,wallet_address,activity_type,token_address,delivered_at,created_at,metadata').order('created_at', { ascending: false }).limit(1000),
]);
if (walletsResult.error) throw walletsResult.error; if (cursorsResult.error) throw cursorsResult.error; if (deliveriesResult.error) throw deliveriesResult.error;
const wallets = walletsResult.data ?? []; const cursors = cursorsResult.data ?? []; const deliveries = deliveriesResult.data ?? [];
let robinhoodHead: bigint | null = null; try { robinhoodHead = await robinhoodPublicClient.getBlockNumber(); } catch { /* report RPC unavailable */ }
const byChain = new Map<string, number>(); for (const wallet of wallets) byChain.set(wallet.chain, (byChain.get(wallet.chain) ?? 0) + 1);
console.log('WALLET MONITOR HEALTH\n\nTRACKED WALLETS'); for (const [chain, count] of byChain) console.log(`- ${chain}: ${count}`);
console.log('\nWALLETS');
const cursorLags: bigint[] = [];
const healthStates: string[] = [];
for (const wallet of wallets) {
  const cursor = cursors.find(row => row.chain === wallet.chain && String(row.wallet_address).toLowerCase() === String(wallet.wallet_address).toLowerCase());
  const lag = cursor && wallet.chain === 'robinhood' && robinhoodHead != null ? robinhoodHead - BigInt(cursor.last_processed_block) : null;
  if (lag != null) cursorLags.push(lag);
  const activity = deliveries.find(row => String(row.wallet_address).toLowerCase() === String(wallet.wallet_address).toLowerCase());
  const unresolved = deliveries.filter(row => String(row.wallet_address).toLowerCase() === String(wallet.wallet_address).toLowerCase() && (row.metadata as Record<string, unknown> | null)?.state === 'RESERVED').length;
  const health = !wallet.is_active ? 'PAUSED' : unresolved > 0 ? 'BLOCKED' : lag == null ? 'STALE' : lag <= 500n ? 'HEALTHY' : 'STALE';
  healthStates.push(health);
  console.log(`- network=${wallet.chain} wallet=${String(wallet.wallet_address).slice(0, 8)}… active=${wallet.is_active} alerts=${wallet.alerts_enabled} head=${wallet.chain === 'robinhood' ? robinhoodHead ?? 'unavailable' : 'unsupported'} cursor=${cursor?.last_processed_block ?? 'unavailable'} lag=${lag ?? 'unavailable'} health=${health} walletCreated=${wallet.created_at ?? 'unknown'} cursorCreated=${cursor?.created_at ?? 'unknown'} lastCheckpoint=${cursor?.updated_at ?? 'none'} lastDetected=${activity?.created_at ?? 'none'} lastDelivered=${activity?.delivered_at ?? 'none'} unresolved=${unresolved}`);
}
const reserved = deliveries.filter(row => (row.metadata as Record<string, unknown> | null)?.state === 'RESERVED');
const failed = deliveries.filter(row => (row.metadata as Record<string, unknown> | null)?.state === 'FAILED');
const cursorFresh = cursors.filter(row => Date.now() - Date.parse(String(row.updated_at)) < 5 * 60_000).length;
const maximumLag = cursorLags.length ? cursorLags.reduce((maximum, lag) => lag > maximum ? lag : maximum, 0n) : null;
const lagHealthy = maximumLag != null && maximumLag <= 500n;
console.log('\nDELIVERY STATE'); console.log(`- reserved: ${reserved.length}`); console.log(`- failed: ${failed.length}`);
const overall = healthStates.includes('BLOCKED') ? 'BLOCKED' : healthStates.includes('STALE') ? 'DEGRADED' : robinhoodHead == null ? 'UNKNOWN' : 'HEALTHY';
console.log('\nPOLLING'); console.log(`- Robinhood RPC: ${robinhoodHead == null ? 'UNAVAILABLE' : 'OK'}`); console.log(`- fresh cursors (<5m): ${cursorFresh}/${cursors.length}`); console.log(`- maximum block lag: ${maximumLag ?? 'unavailable'}`); console.log(`- low-lag target met: ${lagHealthy ? 'YES' : 'NO'}`); console.log(`- overall status: ${overall}`);
