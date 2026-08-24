import 'dotenv/config';
import { robinhoodPublicClient } from '../src/chains/robinhood/rpc.js';
import { supabase } from '../src/services/supabase.js';

const [walletsResult, cursorsResult, deliveriesResult] = await Promise.all([
  supabase.from('user_tracked_wallets').select('telegram_id,wallet_address,chain,is_active,alerts_enabled').eq('is_active', true),
  supabase.from('wallet_monitor_cursors').select('chain,wallet_address,last_processed_block,updated_at'),
  supabase.from('wallet_activity_deliveries').select('telegram_id,wallet_address,activity_type,token_address,delivered_at,created_at,metadata').order('created_at', { ascending: false }).limit(1000),
]);
if (walletsResult.error) throw walletsResult.error; if (cursorsResult.error) throw cursorsResult.error; if (deliveriesResult.error) throw deliveriesResult.error;
const wallets = walletsResult.data ?? []; const cursors = cursorsResult.data ?? []; const deliveries = deliveriesResult.data ?? [];
let robinhoodHead: bigint | null = null; try { robinhoodHead = await robinhoodPublicClient.getBlockNumber(); } catch { /* report RPC unavailable */ }
const byChain = new Map<string, number>(); for (const wallet of wallets) byChain.set(wallet.chain, (byChain.get(wallet.chain) ?? 0) + 1);
console.log('WALLET MONITOR HEALTH\n\nACTIVE TRACKED WALLETS'); for (const [chain, count] of byChain) console.log(`- ${chain}: ${count}`);
console.log('\nCURSORS');
const cursorLags: bigint[] = [];
for (const wallet of wallets) {
  const cursor = cursors.find(row => row.chain === wallet.chain && String(row.wallet_address).toLowerCase() === String(wallet.wallet_address).toLowerCase());
  const lag = cursor && wallet.chain === 'robinhood' && robinhoodHead != null ? robinhoodHead - BigInt(cursor.last_processed_block) : null;
  if (lag != null) cursorLags.push(lag);
  const activity = deliveries.find(row => String(row.wallet_address).toLowerCase() === String(wallet.wallet_address).toLowerCase());
  console.log(`- ${wallet.chain} ${String(wallet.wallet_address).slice(0, 8)}… cursor=${cursor?.last_processed_block ?? 'unavailable'} lag=${lag ?? 'unavailable'} lastActivity=${activity?.created_at ?? 'none'} lastDelivered=${activity?.delivered_at ?? 'none'}`);
}
const reserved = deliveries.filter(row => (row.metadata as Record<string, unknown> | null)?.state === 'RESERVED');
const failed = deliveries.filter(row => (row.metadata as Record<string, unknown> | null)?.state === 'FAILED');
const cursorFresh = cursors.filter(row => Date.now() - Date.parse(String(row.updated_at)) < 5 * 60_000).length;
const maximumLag = cursorLags.length ? cursorLags.reduce((maximum, lag) => lag > maximum ? lag : maximum, 0n) : null;
const lagHealthy = maximumLag != null && maximumLag <= 500n;
console.log('\nDELIVERY STATE'); console.log(`- reserved: ${reserved.length}`); console.log(`- failed: ${failed.length}`);
console.log('\nPOLLING'); console.log(`- Robinhood RPC: ${robinhoodHead == null ? 'UNAVAILABLE' : 'OK'}`); console.log(`- fresh cursors (<5m): ${cursorFresh}/${cursors.length}`); console.log(`- maximum block lag: ${maximumLag ?? 'unavailable'}`); console.log(`- appears healthy: ${robinhoodHead != null && cursorFresh > 0 && lagHealthy ? 'YES' : cursorFresh > 0 ? 'CATCHING UP / DEGRADED' : 'NO/INSUFFICIENT EVIDENCE'}`);
