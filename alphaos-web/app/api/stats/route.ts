import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function countRows(table: string) {
  const { count, error } = await supabaseAdmin
    .from(table)
    .select("*", {
      count: "exact",
      head: true,
    });

  if (error) {
    console.error(`Failed counting ${table}`, error);
    return 0;
  }

  return count ?? 0;
}

export async function GET() {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const [
      tokensTracked,
      timelineEvents,

      alertsTodayResult,

      buysTodayResult,

      reached1mResult,

      latestBuyResult,
    ] = await Promise.all([
      countRows("token_memory"),

      countRows("token_memory_events"),

      supabaseAdmin
        .from("token_memory_events")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("event_type", "ALERT_CREATED")
        .gte("created_at", startOfDay.toISOString()),

      supabaseAdmin
        .from("token_memory_events")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("event_type", "ALERT_CREATED")
        .ilike("note", "%BUY%")
        .gte("created_at", startOfDay.toISOString()),

      supabaseAdmin
        .from("token_memory")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("reached_1m", true),

      supabaseAdmin
        .from("token_memory_events")
        .select(
          `
          token,
          market_cap,
          alpha_score,
          note,
          created_at
        `
        )
        .eq("event_type", "ALERT_CREATED")
        .ilike("note", "%BUY%")
        .order("created_at", {
          ascending: false,
        })
        .limit(1)
        .maybeSingle(),
    ]);

    const latest = latestBuyResult.data;

    const latestBuy = latest
      ? {
          token: latest.token,

          symbol:
            String(latest.note ?? "")
              .split(" alert created")[0]
              .trim() || "UNKNOWN",

          marketCap:
            latest.market_cap != null
              ? Number(latest.market_cap)
              : null,

          score:
            latest.alpha_score != null
              ? Number(latest.alpha_score)
              : null,

          createdAt:
            latest.created_at ?? null,
        }
      : null;

    return NextResponse.json({
      success: true,

      data: {
        scannerStatus: "RUNNING",

        tokensTracked,

        timelineEvents,

        alertsToday:
          alertsTodayResult.count ?? 0,

        buysToday:
          buysTodayResult.count ?? 0,

        moonshots:
          reached1mResult.count ?? 0,

        completedOutcomes:
          timelineEvents,

        winnerRate: 0,

        averagePeakReturn: 0,

        latestBuy,
      },
    });
  } catch (err) {
    console.error(err);

    return NextResponse.json(
      {
        success: false,
        error: "Unable to load dashboard statistics",
      },
      {
        status: 500,
      }
    );
  }
}