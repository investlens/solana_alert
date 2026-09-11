import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [healthResult, robinhoodResult, shadowResult, outcomeResult] = await Promise.all([
      supabaseAdmin
        .from("system_health")
        .select("service,status,message,last_seen_at,updated_at")
        .order("service", { ascending: true }),
      supabaseAdmin
        .from("alpha_alert_events")
        .select("id,asset_id,symbol,semantic_event_type,price,market_cap,liquidity,created_at")
        .eq("chain", "robinhood")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("shadow_intelligence_decisions")
        .select("id,created_at,chain,symbol,current_action,shadow_action,current_adjusted_score,shadow_score,confidence,score_delta,evidence")
        .order("created_at", { ascending: false })
        .limit(8),
      supabaseAdmin
        .from("shadow_decision_outcomes")
        .select("shadow_decision_id,checkpoint_seconds,roi,peak_roi,max_drawdown,outcome_status,measured_at")
        .order("created_at", { ascending: false })
        .limit(24),
    ]);

    if (healthResult.error) throw healthResult.error;
    if (robinhoodResult.error) throw robinhoodResult.error;
    if (shadowResult.error) throw shadowResult.error;
    if (outcomeResult.error) throw outcomeResult.error;

    const latestRobinhood = robinhoodResult.data;
    let deliveryCount = 0;

    if (latestRobinhood?.id) {
      const { count, error } = await supabaseAdmin
        .from("alpha_alert_event_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("alert_event_id", latestRobinhood.id)
        .not("delivered_at", "is", null);

      if (error) throw error;
      deliveryCount = count ?? 0;
    }

    const outcomesByDecision = new Map<number, Array<Record<string, unknown>>>();
    for (const row of outcomeResult.data ?? []) {
      const key = Number(row.shadow_decision_id);
      const existing = outcomesByDecision.get(key) ?? [];
      existing.push(row as Record<string, unknown>);
      outcomesByDecision.set(key, existing);
    }

    const decisions = (shadowResult.data ?? []).map((row) => {
      const evidence = (row.evidence ?? {}) as Record<string, unknown>;
      const engineV2 = (evidence.engineV2 ?? {}) as Record<string, unknown>;

      return {
        id: row.id,
        createdAt: row.created_at,
        chain: row.chain,
        symbol: row.symbol,
        currentAction: row.current_action,
        shadowAction: row.shadow_action,
        currentScore: row.current_adjusted_score != null ? Number(row.current_adjusted_score) : null,
        shadowScore: row.shadow_score != null ? Number(row.shadow_score) : null,
        confidence: row.confidence != null ? Number(row.confidence) : null,
        scoreDelta: row.score_delta != null ? Number(row.score_delta) : null,
        promotionEligible: Boolean(engineV2.promotionEligible),
        topPositiveReasons: Array.isArray(engineV2.topPositiveReasons) ? engineV2.topPositiveReasons : [],
        topNegativeReasons: Array.isArray(engineV2.topNegativeReasons) ? engineV2.topNegativeReasons : [],
        outcomes: outcomesByDecision.get(Number(row.id)) ?? [],
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        health: healthResult.data ?? [],
        latestRobinhood: latestRobinhood
          ? {
              id: latestRobinhood.id,
              token: latestRobinhood.asset_id,
              symbol: latestRobinhood.symbol,
              type: latestRobinhood.semantic_event_type,
              price: latestRobinhood.price != null ? Number(latestRobinhood.price) : null,
              marketCap: latestRobinhood.market_cap != null ? Number(latestRobinhood.market_cap) : null,
              liquidity: latestRobinhood.liquidity != null ? Number(latestRobinhood.liquidity) : null,
              createdAt: latestRobinhood.created_at,
              deliveryCount,
            }
          : null,
        decisions,
      },
    });
  } catch (error) {
    console.error("[Proof API] failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load AlphaOS proof data" },
      { status: 500 },
    );
  }
}
