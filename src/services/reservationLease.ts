import { randomUUID } from 'node:crypto';

export const DELIVERY_LEASE_SECONDS = 300;

export type ReservationState = 'RESERVED' | 'DELIVERED' | string | null | undefined;

export function createLeaseToken(): string {
  return randomUUID();
}

export function reservationCanBeReclaimed(args: {
  state: ReservationState;
  reservedAt: string | number | Date;
  now?: number;
  leaseSeconds?: number;
}): boolean {
  if (args.state !== 'RESERVED') return false;
  const reservedAt = new Date(args.reservedAt).getTime();
  if (!Number.isFinite(reservedAt)) return false;
  const leaseMs = Math.max(args.leaseSeconds ?? DELIVERY_LEASE_SECONDS, 30) * 1000;
  return (args.now ?? Date.now()) - reservedAt >= leaseMs;
}

export type ReservationLeaseRecord = {
  state: ReservationState;
  reservedAt: string | number | Date;
  leaseToken: string;
};

export function reclaimReservationLease(
  current: ReservationLeaseRecord,
  args: { now: number; leaseToken: string; leaseSeconds?: number },
): ReservationLeaseRecord | null {
  if (!reservationCanBeReclaimed({
    state: current.state,
    reservedAt: current.reservedAt,
    now: args.now,
    leaseSeconds: args.leaseSeconds,
  })) return null;
  return { state: 'RESERVED', reservedAt: args.now, leaseToken: args.leaseToken };
}
