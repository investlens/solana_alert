export function opportunityDeliveryIdentity(args: {
  action?: string | null;
  status?: string | null;
}): string {
  const action = String(args.action ?? 'UNKNOWN').trim().toUpperCase();
  const status = String(args.status ?? 'UNKNOWN').trim().toUpperCase();
  return `v1:${action || 'UNKNOWN'}:${status || 'UNKNOWN'}`;
}
