import { NextResponse } from 'next/server';
import { getHolderLaunchConfig } from '@/lib/holder-launch';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json(getHolderLaunchConfig(), { headers: { 'Cache-Control': 'no-store' } });
}
// Fail closed regardless of contract configuration. Never collect signatures or
// grant Pro until authenticated linking, nonce consumption and enforcement exist.
export async function POST() {
  return NextResponse.json({ success: false, code: 'HOLDER_VERIFICATION_NOT_ACTIVE',
    error: 'Holder verification is not active. No wallet signature or payment is required.' },
  { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
