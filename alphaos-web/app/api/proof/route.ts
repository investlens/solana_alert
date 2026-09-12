import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  finiteNumber,
  normalizeChain,
  type LiveIntelligenceProof,
  type ShadowDecision,
  type TopOpportunity,
} from "@/lib/intelligence/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [events, health, shadow, outcomes] = await Promise.all([
      supabaseAdmin
        .from("alpha_alert_events")
        .select("id,asset_id,chain,strategy_key,lifecycle_state,alert_type,symbol,confidence,risk_label,reason,price,price_provenance,market_cap,valuation_provenance,liquidity,volume_5m,dev_holding_percent,dev_holding_evidence,risk_evidence,created_at,intelligence_state,semantic_event_type")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(500),
      supabaseAdmin
        .from("system_health")
        .select("service,status,message,last_seen_at,updated_at")
        .order("service", { ascending: true }),
      supabaseAdmin
        .from("shadow_intelligence_decisions")
        .select("id,created_at,chain,symbol,current_action,shadow_action,current_adjusted_score,shadow_score,confidence,score_delta,evidence")
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("shadow_decision_outcomes")
        .select("shadow_decision_id,checkpoint_seconds,roi,peak_roi,max_drawdown,outcome_status,measured_at")
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    for (const result of [events, health, shadow, outcomes]) {
      if (result.error) throw result.error;
    }

    const rows = events.data ?? [];
    const marketEvidenceRows = rows.filter(
      (row) => row.market_cap != null || row.liquidity != null || row.price != null,
    );

    const highConviction = rows.filter((row) => {
      const confidence = finiteNumber(row.confidence);
      const risk = String(row.risk_label ?? "").toUpperCase();
      return confidence != null && confidence >= 85 && !["HIGH", "CRITICAL"].includes(risk);
    }).length;

    const watching = rows.filter((row) =>
      ["FORMING", "WATCHING", "BUILDING", "EVENT"].includes(
        String(row.lifecycle_state ?? "").toUpperCase(),
      ),
    ).length;

    const riskBlocked = rows.filter((row) => {
      const state = String(row.lifecycle_state ?? "").toUpperCase();
      const risk = String(row.risk_label ?? "").toUpperCase();
      return ["DANGER", "WEAKENING", "COOLING"].includes(state) || ["HIGH", "CRITICAL"].includes(risk);
    }).length;

    const ranked = [...marketEvidenceRows].sort(
      (a, b) =>
        (finiteNumber(b.confidence) ?? -1) - (finiteNumber(a.confidence) ?? -1) ||
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const top = ranked[0] ?? null;

    const topOpportunity: TopOpportunity | null = top
      ? {
          id: top.id,
          token: top.asset_id,
          chain: normalizeChain(top.chain),
          symbol: top.symbol ?? null,
          state: top.lifecycle_state ?? null,
          type: top.semantic_event_type ?? top.alert_type ?? null,
          confidence: finiteNumber(top.confidence),
          risk: top.risk_label ?? null,
          reason: top.reason ?? null,
          price: finiteNumber(top.price),
          marketCap: finiteNumber(top.market_cap),
          liquidity: finiteNumber(top.liquidity),
          volume5m: finiteNumber(top.volume_5m),
          devHolding: finiteNumber(top.dev_holding_percent),
          devHoldingEvidence: top.dev_holding_evidence ?? null,
          priceProvenance: top.price_provenance ?? null,
          valuationProvenance: top.valuation_provenance ?? null,
          createdAt: top.created_at ?? null,
        }
      : null;

    const outcomeMap = new Map<number, unknown[]>();
    for (const outcome of outcomes.data ?? []) {
      const key = Number(outcome.shadow_decision_id);
      const existing = outcomeMap.get(key) ?? [];
      existing.push(outcome);
      outcomeMap.set(key, existing);
    }

    const decisions: ShadowDecision[] = (shadow.data ?? []).map((row) => {
      const evidence = (row.evidence ?? {}) as Record<string, unknown>;
      const engineV2 = (evidence.engineV2 ?? {}) as Record<string, unknown>;

      return {
        id: row.id,
        createdAt: row.created_at,
        chain: row.chain,
        symbol: row.symbol,
        currentAction: row.current_action,
        shadowAction: row.shadow_action,
        currentScore: finiteNumber(row.current_adjusted_score),
        shadowScore: finiteNumber(row.shadow_score),
        confidence: finiteNumber(row.confidence),
        scoreDelta: finiteNumber(row.score_delta),
        promotionEligible: Boolean(engineV2.promotionEligible),
        topPositiveReasons: Array.isArray(engineV2.topPositiveReasons) ? engineV2.topPositiveReasons : [],
        topNegativeReasons: Array.isArray(engineV2.topNegativeReasons) ? engineV2.topNegativeReasons : [],
        outcomes: outcomeMap.get(Number(row.id)) ?? [],
      };
    });

    const payload: LiveIntelligenceProof = {
      generatedAt: new Date().toISOString(),
      status: {
        highConviction,
        watching,
        riskBlocked,
        totalEvents: rows.length,
        marketEvidenceEvents: marketEvidenceRows.length,
      },
      topOpportunity,
      health: health.data ?? [],
      decisions,
    };

    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error("[Proof API] failed", error);
    return NextResponse.json(
      { success: false, error: "Unable to load verified AlphaOS intelligence" },
      { status: 500 },
    );
  }
}
