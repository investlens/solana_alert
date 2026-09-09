import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WindowKey = "today" | "7d" | "30d" | "all";

function sinceFor(window: WindowKey): string | null {
  if (window === "all") return null;
  const now = new Date();
  if (window === "today") now.setUTCHours(0, 0, 0, 0);
  if (window === "7d") now.setUTCDate(now.getUTCDate() - 7);
  if (window === "30d") now.setUTCDate(now.getUTCDate() - 30);
  return now.toISOString();
}

function inferChain(token: string | null): "solana" | "robinhood" | "unknown" {
  if (!token) return "unknown";
  if (token.startsWith("0x")) return "robinhood";
  return "solana";
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("window") as WindowKey | null;
    const window: WindowKey = requested && ["today", "7d", "30d", "all"].includes(requested) ? requested : "today";

    let query = supabaseAdmin
      .from("alerts")
      .select("id, token_address, symbol, name, score_at_alert, alert_price, current_price, high_price_after_alert, roi_high, alerted_at, alert_type")
      .not("alert_price", "is", null)
      .order("alerted_at", { ascending: false })
      .limit(500);

    const since = sinceFor(window);
    if (since) query = query.gte("alerted_at", since);

    const { data, error } = await query;
    if (error) throw error;

    const rows = data ?? [];
    const tokens = [...new Set(rows.map((row) => row.token_address ? String(row.token_address) : "").filter(Boolean))];
    const earliestAlert = rows.length
      ? rows.reduce((min, row) => {
          const value = row.alerted_at ? String(row.alerted_at) : min;
          return !min || (value && value < min) ? value : min;
        }, "")
      : "";

    const eventMap = new Map<string, Array<{ price: number; createdAt: string }>>();
    if (tokens.length && earliestAlert) {
      const { data: events, error: eventError } = await supabaseAdmin
        .from("token_memory_events")
        .select("token, price, created_at")
        .in("token", tokens)
        .gte("created_at", earliestAlert)
        .not("price", "is", null)
        .order("created_at", { ascending: true })
        .limit(10000);
      if (eventError) console.error("top-alerts event history", eventError);
      for (const event of events ?? []) {
        const token = event.token ? String(event.token) : "";
        const price = numeric(event.price);
        const createdAt = event.created_at ? String(event.created_at) : "";
        if (!token || price === null || !createdAt) continue;
        const list = eventMap.get(token) ?? [];
        list.push({ price, createdAt });
        eventMap.set(token, list);
      }
    }

    const mapped = rows.map((row) => {
      const token = row.token_address ? String(row.token_address) : "";
      const alertedAt = row.alerted_at ? String(row.alerted_at) : null;
      const alertPrice = numeric(row.alert_price);
      const storedHighPrice = numeric(row.high_price_after_alert);
      const currentPrice = numeric(row.current_price);

      const eventPeak = alertedAt
        ? (eventMap.get(token) ?? [])
            .filter((event) => event.createdAt >= alertedAt)
            .reduce<number | null>((max, event) => max === null || event.price > max ? event.price : max, null)
        : null;

      const peakPrice = eventPeak !== null
        ? Math.max(eventPeak, alertPrice ?? eventPeak)
        : storedHighPrice;

      const roiHigh = alertPrice !== null && alertPrice > 0 && peakPrice !== null
        ? ((peakPrice - alertPrice) / alertPrice) * 100
        : null;
      const roiNow = alertPrice !== null && alertPrice > 0 && currentPrice !== null
        ? ((currentPrice - alertPrice) / alertPrice) * 100
        : null;

      return {
        id: String(row.id),
        token,
        symbol: row.symbol ? String(row.symbol) : "UNKNOWN",
        name: row.name ? String(row.name) : null,
        chain: inferChain(token || null),
        score: numeric(row.score_at_alert),
        alertPrice,
        currentPrice,
        peakPrice,
        roiHigh,
        roiNow,
        alertedAt,
        alertType: row.alert_type ? String(row.alert_type) : null,
      };
    });

    const items = mapped
      .filter((item) => item.roiHigh !== null)
      .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity));

    const winners = items.filter((item) => (item.roiHigh ?? 0) > 0).length;
    const over100 = items.filter((item) => (item.roiHigh ?? 0) >= 100).length;
    const positivePeaks = items.map((item) => item.roiHigh).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
    const medianPeak = positivePeaks.length ? positivePeaks[Math.floor(positivePeaks.length / 2)] : null;

    return NextResponse.json({
      success: true,
      data: {
        window,
        top: items[0] ?? null,
        leaders: items.slice(0, 5),
        recent: mapped.slice(0, 8),
        summary: { tracked: items.length, winners, over100, medianPeak },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("top-alerts", error);
    return NextResponse.json({ success: false, error: "Unable to load alert performance" }, { status: 500 });
  }
}
