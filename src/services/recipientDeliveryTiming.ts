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
export async function waitForRecipientDelivery(user: Recipient | string, startedAt: number, safetyCritical = false): Promise<void> {
  const now = Date.now();
  const cached = typeof user === 'string' ? recipients.get(user) : undefined;
  const resolved = typeof user === 'string'
    ? cached && now - cached.refreshedAt < CACHE_MS ? cached.user : { telegram_id: user }
    : user;
  const delay = remainingDeliveryDelay(resolved, startedAt, now, safetyCritical);
  if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
}
export function isUndelayedRiskEvent(type: string): boolean {
  return new Set(['EXIT', 'COOLING', 'WEAKENING', 'DANGER', 'DEV_TRANSFER', 'DEV_SELL', 'LIQUIDITY_RISK', 'WALLET_CLUSTER']).has(type.toUpperCase());
}
