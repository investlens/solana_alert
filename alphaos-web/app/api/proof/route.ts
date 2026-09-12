import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { finiteNumber, normalizeChain, type LifecycleEvent, type LiveIntelligenceProof, type TokenLifecycle, type TopOpportunity } from "@/lib/intelligence/types";

export const dynamic = "force-dynamic";

let lastGood: LiveIntelligenceProof | null = null;

function assetKey(row: Record<string, any>) {
  return `${String(row.chain ?? "unknown").toLowerCase()}:${String(row.asset_id ?? "").toLowerCase()}`;
}

function emptyPayload(): LiveIntelligenceProof {
  return {
    generatedAt: new Date().toISOString(),
    status: { highConviction: 0, watching: 0, riskBlocked: 0, totalEvents: 0, marketEvidenceEvents: 0 },
    topOpportunity: null,
    lifecycles: [],
    health: [],
    decisions: [],
  };
}

export async function GET() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Proof is a display surface, not a critical scanner. Keep it cheap and bounded.
    const [events, health, topResult] = await Promise.all([
      supabaseAdmin
        .from("alpha_alert_events")
        .select("id,asset_id,chain,lifecycle_state,alert_type,symbol,confidence,risk_label,reason,current_roi,price,market_cap,liquidity,created_at,intelligence_state,semantic_event_type")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(120)
        .abortSignal(AbortSignal.timeout(4_000)),
      supabaseAdmin
        .from("system_health")
        .select("service,status,message,last_seen_at,updated_at")
        .order("service", { ascending: true })
        .limit(50)
        .abortSignal(AbortSignal.timeout(3_000)),
      supabaseAdmin
        .from("alpha_live_asset_state_24h")
        .select("id,asset_id,chain,lifecycle_state,intelligence_state,alert_type,semantic_event_type,symbol,confidence,risk_label,reason,price,market_cap,liquidity,volume_5m,dev_holding_percent,created_at,is_high_conviction,is_watching,is_risk_blocked,has_market_evidence")
        .eq("has_market_evidence", true)
        .eq("is_risk_blocked", false)
        .order("confidence", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(40)
        .abortSignal(AbortSignal.timeout(4_000)),
    ]);

    if (events.error) throw events.error;
    if (health.error) throw health.error;
    if (topResult.error) throw topResult.error;

    const rows = events.data ?? [];
    const stateRows = topResult.data ?? [];
    const top = stateRows[0] ?? null;

    const topOpportunity: TopOpportunity | null = top
      ? {
          id: top.id,
          token: top.asset_id,
          chain: normalizeChain(top.chain),
          symbol: top.symbol ?? null,
          state: top.lifecycle_state ?? top.intelligence_state ?? null,
          type: top.semantic_event_type ?? top.alert_type ?? null,
          confidence: finiteNumber(top.confidence),
          risk: top.risk_label ?? null,
          reason: top.reason ?? null,
          price: finiteNumber(top.price),
          marketCap: finiteNumber(top.market_cap),
          liquidity: finiteNumber(top.liquidity),
          volume5m: finiteNumber(top.volume_5m),
          devHolding: finiteNumber(top.dev_holding_percent),
          devHoldingEvidence: null,
          priceProvenance: null,
          valuationProvenance: null,
          createdAt: top.created_at ?? null,
        }
      : null;

    const lifecycleMap = new Map<string, TokenLifecycle>();
    for (const row of [...rows].reverse()) {
      if (!row.asset_id) continue;
      const key = assetKey(row);
      const event: LifecycleEvent = {
        id: row.id,
        token: row.asset_id,
        chain: normalizeChain(row.chain),
        symbol: row.symbol ?? null,
        state: row.lifecycle_state ?? row.intelligence_state ?? null,
        type: row.semantic_event_type ?? row.alert_type ?? null,
        confidence: finiteNumber(row.confidence),
        risk: row.risk_label ?? null,
        reason: row.reason ?? null,
        currentRoi: finiteNumber(row.current_roi),
        marketCap: finiteNumber(row.market_cap),
        liquidity: finiteNumber(row.liquidity),
        observedAt: row.created_at ?? null,
      };
      const existing = lifecycleMap.get(key);
      if (!existing) {
        lifecycleMap.set(key, {
          token: row.asset_id,
          chain: normalizeChain(row.chain),
          symbol: row.symbol ?? null,
          currentState: event.state,
          currentRisk: row.risk_label ?? null,
          latestObservedAt: row.created_at ?? null,
          events: [event],
        });
      } else {
        existing.events.push(event);
        existing.currentState = event.state ?? existing.currentState;
        existing.currentRisk = row.risk_label ?? existing.currentRisk;
        existing.latestObservedAt = row.created_at ?? existing.latestObservedAt;
        existing.symbol = row.symbol ?? existing.symbol;
      }
    }

    const lifecycles = [...lifecycleMap.values()]
      .filter((item) => item.events.length >= 2)
      .sort((a, b) => new Date(b.latestObservedAt ?? 0).getTime() - new Date(a.latestObservedAt ?? 0).getTime())
      .slice(0, 8);

    const payload: LiveIntelligenceProof = {
      generatedAt: new Date().toISOString(),
      status: {
        highConviction: stateRows.filter((row) => row.is_high_conviction).length,
        watching: stateRows.filter((row) => row.is_watching).length,
        riskBlocked: stateRows.filter((row) => row.is_risk_blocked).length,
        totalEvents: new Set(rows.map((row) => assetKey(row))).size,
        marketEvidenceEvents: stateRows.filter((row) => row.has_market_evidence).length,
      },
      topOpportunity,
      lifecycles,
      health: health.data ?? [],
      decisions: [],
    };

    lastGood = payload;
    return NextResponse.json({ success: true, data: payload });
  } catch (error) {
    console.error("[Proof API] fast path failed", error);
    return NextResponse.json({
      success: true,
      data: lastGood ?? emptyPayload(),
      degraded: true,
    });
  }
}
