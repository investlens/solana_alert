import { NextResponse } from 'next/server';
// Fail closed until authenticated entitlement and distributed rate limits exist.
export async function POST() {
  return NextResponse.json({error:'Browser AI analysis is not available. Use the Telegram bot for supported research.'},{status:410});
}
