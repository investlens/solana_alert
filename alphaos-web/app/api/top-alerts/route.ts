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
    const window: WindowKey = requested && ["today", "7d", "30d", "all"].includes(requested)
      ? requested
      : "today";

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

    const mapped = (data ?? []).map((row) => {
      const alertPrice = numeric(row.alert_price);
      const highPrice = numeric(row.high_price_after_alert);
      const currentPrice = numeric(row.current_price);
      const storedHigh = numeric(row.roi_high);
      const computedHigh = alertPrice && highPrice
        ? ((highPrice - alertPrice) / alertPrice) * 100
        : null;
      const roiHigh = storedHigh ?? computedHigh;
      const roiNow = alertPrice && currentPrice
        ? ((currentPrice - alertPrice) / alertPrice) * 100
        : null;

      return {
        id: String(row.id),
        token: row.token_address ? String(row.token_address) : "",
        symbol: row.symbol ? String(row.symbol) : "UNKNOWN",
        name: row.name ? String(row.name) : null,
        chain: inferChain(row.token_address ? String(row.token_address) : null),
        score: numeric(row.score_at_alert),
        alertPrice,
        currentPrice,
        highPrice,
        roiHigh,
        roiNow,
        alertedAt: row.alerted_at ? String(row.alerted_at) : null,
        alertType: row.alert_type ? String(row.alert_type) : null,
      };
    });

    const items = mapped
      .filter((item) => item.roiHigh !== null)
      .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity));

    const winners = items.filter((item) => (item.roiHigh ?? 0) > 0).length;
    const over100 = items.filter((item) => (item.roiHigh ?? 0) >= 100).length;
    const medianPeak = items.length
      ? [...items].map((item) => item.roiHigh ?? 0).sort((a, b) => a - b)[Math.floor(items.length / 2)]
      : null;

    return NextResponse.json({
      success: true,
      data: {
        window,
        top: items[0] ?? null,
        leaders: items.slice(0, 5),
        recent: mapped.slice(0, 8),
        summary: {
          tracked: items.length,
          winners,
          over100,
          medianPeak,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("top-alerts", error);
    return NextResponse.json(
      { success: false, error: "Unable to load alert performance" },
      { status: 500 }
    );
  }
}
