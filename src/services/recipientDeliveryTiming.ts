// Delivery timing is independent of billing/tool access. No database writes.
type Recipient = { telegram_id?: string; tier?: string; subscription_status?: string; paid_active_until?: string | null };
const recipients = new Map<string, { user: Recipient; refreshedAt: number }>();
const CACHE_MS = 10 * 60_000;
const MAX_RECIPIENTS = 5_000;
export function cacheDeliveryRecipients(users: Recipient[], now = Date.now()): void {
  for (const [id, entry] of recipients) if (now - entry.refreshedAt >= CACHE_MS) recipients.delete(id);
  for (const user of users) {
    if (!user.telegram_id) continue;
    recipients.delete(String(user.telegram_id));
    recipients.set(String(user.telegram_id), { user: { ...user }, refreshedAt: now });
    while (recipients.size > MAX_RECIPIENTS) recipients.delete(recipients.keys().next().value!);
  }
}
export function recipientDelayMs(user: Recipient, now = Date.now()): number {
  const id = String(user.telegram_id ?? '');
  const admins = [process.env.ADMIN_TELEGRAM_ID, process.env.OWNER_CHAT_ID].filter(Boolean);
  if (user.tier === 'admin' || (id && admins.includes(id))) return 0;
  if (user.tier === 'paid' && user.subscription_status === 'active' && Date.parse(user.paid_active_until ?? '') > now) return 5_000;
  return 30_000;
}
export function remainingDeliveryDelay(user: Recipient, startedAt: number, now = Date.now(), safetyCritical = false): number {
  return safetyCritical ? 0 : Math.max(0, startedAt + recipientDelayMs(user, now) - now);
}
function resolveRecipient(user: Recipient | string, now: number): Recipient {
  if (typeof user !== 'string') return user;
  const cached = recipients.get(user);
  return cached && now - cached.refreshedAt < CACHE_MS ? cached.user : { telegram_id: user };
}
export async function waitForRecipientDelivery(user: Recipient | string, startedAt: number, safetyCritical = false): Promise<void> {
  const now = Date.now();
  const delay = remainingDeliveryDelay(resolveRecipient(user, now), startedAt, now, safetyCritical);
  if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
}
export function deliveryAcceptanceEvidence(user: Recipient | string, startedAt: number, source: string, safetyCritical = false, now = Date.now()) {
  const delayMs = safetyCritical ? 0 : recipientDelayMs(resolveRecipient(user, now), now);
  return { source: source.slice(0, 160), tier: delayMs === 5_000 ? 'pro' : delayMs === 30_000 ? 'free' : 'undelayed',
    releaseDelayMs: delayMs, startedAt: new Date(startedAt).toISOString(), acceptedAt: new Date(now).toISOString(),
    elapsedMs: now - startedAt, releaseLatenessMs: Math.max(0, now - startedAt - delayMs), releaseDeadlineMet: now >= startedAt + delayMs };
}
// Runtime logs only: no recipient IDs, no additional database rows, no replay.
export function recordDeliveryAccepted(user: Recipient | string, startedAt: number, source: string, safetyCritical = false): void {
  console.log('[AlertDeliveryTiming] TELEGRAM_ACCEPTED', deliveryAcceptanceEvidence(user, startedAt, source, safetyCritical));
}
export function isUndelayedRiskEvent(type: string): boolean {
  return new Set(['EXIT', 'COOLING', 'WEAKENING', 'DANGER', 'DEV_TRANSFER', 'DEV_SELL', 'LIQUIDITY_RISK', 'WALLET_CLUSTER']).has(type.toUpperCase());
}

// Separate tier lanes prevent a sleeping free recipient from occupying a Pro/admin slot.
// Four workers per lane bound network concurrency without changing release times.
export async function forEachDeliveryRecipient<T extends Recipient | string>(users:T[], task:(user:T,index:number)=>Promise<void>):Promise<void> {
 const lanes=new Map<number,Array<{user:T,index:number}>>();
 users.forEach((user,index)=>{const delay=recipientDelayMs(resolveRecipient(user,Date.now()));const lane=lanes.get(delay)??[];lane.push({user,index});lanes.set(delay,lane);});
 await Promise.all([...lanes.values()].map(async lane=>{
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,lane.length)},async()=>{
   while(next<lane.length){const item=lane[next++];await task(item.user,item.index);}
  }));
 }));
}
