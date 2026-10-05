import { NextResponse } from 'next/server';
// Retired dashboard inferred scanner health and returns from unrelated row counts.
export async function GET() {
  return NextResponse.json({success:false,error:'Legacy statistics retired. See current recorded research and data coverage.'},{status:410});
}
