import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type WindowKey = "today" | "7d";

type AlertItem = {
  id: string;
  token: string;
  symbol: string;
  name: string | null;
  chain: "solana" | "robinhood" | "unknown";
  score: number | null;
  alertPrice: number | null;
  currentPrice: number | null;
  peakPrice: number | null;
  roiHigh: number | null;
  roiNow: number | null;
  alertedAt: string | null;
  alertType: string | null;
};

function sinceFor(window: WindowKey): string {
  const now = new Date();
  if (window === "today") now.setUTCHours(0, 0, 0, 0);
  else now.setUTCDate(now.getUTCDate() - 7);
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

function leadersFor(items: AlertItem[], chain: "solana" | "robinhood") {
  return items
    .filter((item) => item.chain === chain && item.roiHigh !== null)
    .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity))
    .slice(0, 5);
}

export async function GET(request: NextRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("window");
    const window: WindowKey = requested === "7d" ? "7d" : "today";

    const { data, error } = await supabaseAdmin
      .from("alerts")
      .select("id, token_address, symbol, name, score_at_alert, alert_price, current_price, high_price_after_alert, alerted_at, alert_type")
      .not("alert_price", "is", null)
      .gte("alerted_at", sinceFor(window))
      .order("alerted_at", { ascending: false })
      .limit(750);

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
        .limit(15000);

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

    const mapped: AlertItem[] = rows.map((row) => {
      const token = row.token_address ? String(row.token_address) : "";
      const alertedAt = row.alerted_at ? String(row.alerted_at) : null;
      const alertPrice = numeric(row.alert_price);
      const storedHighPrice = numeric(row.high_price_after_alert);
      const storedCurrentPrice = numeric(row.current_price);
      const postAlertEvents = alertedAt
        ? (eventMap.get(token) ?? []).filter((event) => event.createdAt >= alertedAt)
        : [];

      const eventPeak = postAlertEvents.reduce<number | null>(
        (max, event) => max === null || event.price > max ? event.price : max,
        null,
      );
      const latestEventPrice = postAlertEvents.length ? postAlertEvents[postAlertEvents.length - 1].price : null;
      const peakPrice = eventPeak !== null
        ? Math.max(eventPeak, alertPrice ?? eventPeak)
        : storedHighPrice;
      const currentPrice = latestEventPrice ?? storedCurrentPrice;
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

    const solanaLeaders = leadersFor(mapped, "solana");
    const robinhoodLeaders = leadersFor(mapped, "robinhood");
    const ranked = [...mapped]
      .filter((item) => item.roiHigh !== null)
      .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity));
    const winners = ranked.filter((item) => (item.roiHigh ?? 0) > 0).length;
    const over100 = ranked.filter((item) => (item.roiHigh ?? 0) >= 100).length;
    const positivePeaks = ranked
      .map((item) => item.roiHigh)
      .filter((value): value is number => value !== null && value > 0)
      .sort((a, b) => a - b);
    const medianPeak = positivePeaks.length ? positivePeaks[Math.floor(positivePeaks.length / 2)] : null;

    return NextResponse.json({
      success: true,
      data: {
        window,
        solanaLeaders,
        robinhoodLeaders,
        recent: mapped.slice(0, 12),
        summary: { tracked: ranked.length, winners, over100, medianPeak },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("top-alerts", error);
    return NextResponse.json({ success: false, error: "Unable to load alert performance" }, { status: 500 });
  }
}
