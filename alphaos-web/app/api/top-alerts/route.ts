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

type Payload = {
  window: WindowKey;
  solanaLeaders: AlertItem[];
  robinhoodLeaders: AlertItem[];
  recent: AlertItem[];
  summary: { tracked: number; winners: number; over100: number; medianPeak: number | null };
  generatedAt: string;
  degraded?: boolean;
};

const cache = new Map<WindowKey, Payload>();
const numeric = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function sinceFor(window: WindowKey) {
  const d = new Date();
  if (window === "today") d.setUTCHours(0, 0, 0, 0);
  else d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString();
}

function inferChain(token: string | null): "solana" | "robinhood" | "unknown" {
  if (!token) return "unknown";
  return token.startsWith("0x") ? "robinhood" : "solana";
}

function roi(alertPrice: number | null, price: number | null) {
  return alertPrice && price !== null ? ((price - alertPrice) / alertPrice) * 100 : null;
}

function leadersFor(items: AlertItem[], chain: "solana" | "robinhood") {
  const chainItems = items.filter((item) => item.chain === chain);
  const ranked = chainItems
    .filter((item) => item.roiHigh !== null)
    .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity));
  const seen = new Set(ranked.map((item) => item.id));
  const recentFill = chainItems
    .filter((item) => !seen.has(item.id))
    .sort((a, b) => new Date(b.alertedAt ?? 0).getTime() - new Date(a.alertedAt ?? 0).getTime());
  return [...ranked, ...recentFill].slice(0, 5);
}

function buildPayload(window: WindowKey, items: AlertItem[], degraded = false): Payload {
  const mapped = [...items].sort(
    (a, b) => new Date(b.alertedAt ?? 0).getTime() - new Date(a.alertedAt ?? 0).getTime(),
  );
  const ranked = mapped
    .filter((item) => item.roiHigh !== null)
    .sort((a, b) => (b.roiHigh ?? -Infinity) - (a.roiHigh ?? -Infinity));
  const winners = ranked.filter((item) => (item.roiHigh ?? 0) > 0).length;
  const over100 = ranked.filter((item) => (item.roiHigh ?? 0) >= 100).length;
  const positive = ranked
    .map((item) => item.roiHigh)
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b);
  const medianPeak = positive.length ? positive[Math.floor(positive.length / 2)] : null;

  return {
    window,
    solanaLeaders: leadersFor(mapped, "solana"),
    robinhoodLeaders: leadersFor(mapped, "robinhood"),
    recent: mapped.slice(0, 10),
    summary: { tracked: mapped.length, winners, over100, medianPeak },
    generatedAt: new Date().toISOString(),
    degraded,
  };
}

export async function GET(request: NextRequest) {
  const window: WindowKey = request.nextUrl.searchParams.get("window") === "7d" ? "7d" : "today";
  const since = sinceFor(window);
  const signal = AbortSignal.timeout(4_000);

  try {
    // Homepage fast path: use the stored alert snapshot rather than rebuilding price history.
    const { data: alertRows, error: alertError } = await supabaseAdmin
      .from("alerts")
      .select("id, token_address, symbol, name, score_at_alert, alert_price, current_price, high_price_after_alert, alerted_at, alert_type")
      .gte("alerted_at", since)
      .order("alerted_at", { ascending: false })
      .limit(100)
      .abortSignal(signal);
    if (alertError) throw alertError;

    const solana: AlertItem[] = (alertRows ?? []).map((row) => {
      const token = String(row.token_address ?? "");
      const alertPrice = numeric(row.alert_price);
      const currentPrice = numeric(row.current_price) ?? alertPrice;
      const peakPrice = numeric(row.high_price_after_alert) ?? currentPrice;
      return {
        id: String(row.id),
        token,
        symbol: row.symbol ? String(row.symbol) : "UNKNOWN",
        name: row.name ? String(row.name) : null,
        chain: inferChain(token),
        score: numeric(row.score_at_alert),
        alertPrice,
        currentPrice,
        peakPrice,
        roiHigh: roi(alertPrice, peakPrice),
        roiNow: roi(alertPrice, currentPrice),
        alertedAt: row.alerted_at ? String(row.alerted_at) : null,
        alertType: row.alert_type ? String(row.alert_type) : null,
      };
    }).filter((item) => item.chain === "solana");

    // Keep Robinhood/PONS lightweight: only recent delivered event IDs, then their alert snapshots.
    let robinhood: AlertItem[] = [];
    try {
      const { data: deliveries, error: deliveryError } = await supabaseAdmin
        .from("alpha_alert_event_deliveries")
        .select("alert_event_id, delivered_at")
        .not("delivered_at", "is", null)
        .gte("delivered_at", since)
        .order("delivered_at", { ascending: false })
        .limit(75)
        .abortSignal(AbortSignal.timeout(3_000));
      if (deliveryError) throw deliveryError;

      const ids = [...new Set((deliveries ?? []).map((row) => numeric(row.alert_event_id)).filter((v): v is number => v !== null))];
      if (ids.length) {
        const { data: events, error: eventError } = await supabaseAdmin
          .from("alpha_alert_events")
          .select("id, asset_id, symbol, token_name, confidence, price, current_roi, alerted_at, alert_type")
          .in("id", ids)
          .eq("chain", "robinhood")
          .order("alerted_at", { ascending: false })
          .limit(75)
          .abortSignal(AbortSignal.timeout(3_000));
        if (eventError) throw eventError;

        robinhood = (events ?? []).map((row) => {
          const alertPrice = numeric(row.price);
          const roiNow = numeric(row.current_roi);
          const currentPrice = alertPrice !== null && roiNow !== null ? alertPrice * (1 + roiNow / 100) : alertPrice;
          return {
            id: `rh-${row.id}`,
            token: String(row.asset_id ?? ""),
            symbol: row.symbol ? String(row.symbol) : "UNKNOWN",
            name: row.token_name ? String(row.token_name) : null,
            chain: "robinhood" as const,
            score: numeric(row.confidence),
            alertPrice,
            currentPrice,
            peakPrice: currentPrice,
            roiHigh: roiNow,
            roiNow,
            alertedAt: row.alerted_at ? String(row.alerted_at) : null,
            alertType: row.alert_type ? String(row.alert_type) : null,
          };
        });
      }
    } catch (error) {
      console.warn("top-alerts robinhood snapshot unavailable", error);
    }

    const payload = buildPayload(window, [...solana, ...robinhood]);
    cache.set(window, payload);
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error("top-alerts fast path", error);
    const cached = cache.get(window);
    if (cached) {
      return NextResponse.json({ success: true, data: { ...cached, degraded: true } });
    }
    return NextResponse.json({
      success: true,
      data: buildPayload(window, [], true),
    });
  }
}
