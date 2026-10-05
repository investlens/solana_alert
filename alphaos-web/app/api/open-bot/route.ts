import { NextResponse } from "next/server";
export const runtime = "nodejs";
let cached: { username: string; until: number } | null = null;
let pending: Promise<string | null> | null = null;
async function resolveUsername(): Promise<string | null> {
  const configured = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (configured && /^[A-Za-z0-9_]{5,32}$/.test(configured)) return configured;
  if (cached && cached.until > Date.now()) return cached.username;
  if (pending) return pending;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  pending = (async () => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(4000), cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json(); const username = data?.result?.username;
      if (!data?.ok || typeof username !== "string" || !/^[A-Za-z0-9_]{5,32}$/.test(username)) return null;
      cached = { username, until: Date.now() + 3_600_000 }; return username;
    } catch { return null; }
  })();
  try { return await pending; } finally { pending = null; }
}
export async function GET(request: Request) {
  const username = await resolveUsername();
  return NextResponse.redirect(username ? `https://t.me/${username}` : new URL("/guide?bot=unavailable", request.url), 307);
}
