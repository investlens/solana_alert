import { NextResponse } from 'next/server';
// Legacy proof mixed unverified market values with confidence-ranked assertions.
export async function GET() {
  return NextResponse.json({success:false,error:'Legacy proof retired. Use /api/opportunities and /api/top-alerts for recorded evidence.'},{status:410});
}
