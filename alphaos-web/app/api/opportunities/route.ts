import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type {
  ApiResponse,
  LiveOpportunity,
  OpportunitiesResponse,
  OpportunityStatus,
  OpportunityType,
  RiskLevel,
  Chain,
} from "@/lib/dashboard/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type OpportunityRow = {
  id: string | number;
  opportunity_type: string | null;
  asset_id: string | null;
  chain: string | null;
  source_agent: string | null;
  title: string | null;
  entry_price: number | string | null;
  exit_price: number | string | null;
  expected_profit: number | string | null;
  expected_profit_percent: number | string | null;
  risk_score: number | string | null;
  confidence: number | string | null;
  status: string | null;
  raw_data: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function normalizeChain(value: unknown): Chain {
  const chain = String(value ?? "")
    .trim()
    .toLowerCase();

  if (
    chain === "solana" ||
    chain === "ethereum" ||
    chain === "base" ||
    chain === "robinhood" ||
    chain === "sui" ||
    chain === "bsc"
  ) {
    return chain;
  }

  return "unknown";
}

function normalizeOpportunityType(
  value: unknown
): OpportunityType {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();

  const allowed: OpportunityType[] = [
    "TOKEN_PREDEX",
    "TOKEN_CREATOR",
    "TOKEN_WALLET",
    "DEX_CONFIRMATION",
    "NFT_MISPRICE",
    "NFT_OFFER_ARBITRAGE",
    "CEX_DEX_ARB",
    "PREDICTION_MARKET",
    "NEWS_CATALYST",
  ];

  return allowed.includes(normalized as OpportunityType)
    ? (normalized as OpportunityType)
    : "TOKEN_PREDEX";
}

function normalizeStatus(
  value: unknown
): OpportunityStatus {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();

  const allowed: OpportunityStatus[] = [
    "NEW",
    "WATCHING",
    "APPROVED",
    "EXECUTED",
    "REJECTED",
    "EXPIRED",
    "REVIEWED",
  ];

  return allowed.includes(normalized as OpportunityStatus)
    ? (normalized as OpportunityStatus)
    : "NEW";
}

function normalizeRiskLevel(
  riskScore: number | null,
  rawData: Record<string, unknown>
): RiskLevel {
  const explicitRisk = String(
    rawData.risk_level ??
      rawData.riskLevel ??
      rawData.risk ??
      ""
  )
    .trim()
    .toUpperCase();

  if (
    explicitRisk === "LOW" ||
    explicitRisk === "MEDIUM" ||
    explicitRisk === "HIGH"
  ) {
    return explicitRisk;
  }

  if (riskScore === null) {
    return "UNKNOWN";
  }

  if (riskScore <= 35) {
    return "LOW";
  }

  if (riskScore <= 70) {
    return "MEDIUM";
  }

  return "HIGH";
}

function pickString(
  rawData: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = toStringValue(rawData[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function pickNumber(
  rawData: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const value = toNumber(rawData[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function buildReportUrl(token: string): string {
  return `/report/${encodeURIComponent(token)}`;
}

function normalizeOpportunity(
  row: OpportunityRow
): LiveOpportunity {
  const rawData =
    row.raw_data &&
    typeof row.raw_data === "object" &&
    !Array.isArray(row.raw_data)
      ? row.raw_data
      : {};

  const assetId =
    toStringValue(row.asset_id) ??
    pickString(rawData, [
      "token",
      "address",
      "mint",
      "tokenAddress",
      "token_address",
      "assetId",
      "asset_id",
    ]) ??
    "unknown";

  const symbol =
    pickString(rawData, [
      "symbol",
      "token_symbol",
      "tokenSymbol",
      "ticker",
    ]) ??
    toStringValue(row.title) ??
    "UNKNOWN";

  const token =
    pickString(rawData, [
      "token",
      "address",
      "mint",
      "tokenAddress",
      "token_address",
    ]) ?? assetId;

  const confidence =
    toNumber(row.confidence) ??
    pickNumber(rawData, [
      "confidence",
      "score",
      "alpha_score",
      "alphaScore",
    ]) ??
    0;

  const riskScore =
    toNumber(row.risk_score) ??
    pickNumber(rawData, [
      "risk_score",
      "riskScore",
    ]) ??
    0;

  const marketCap = pickNumber(rawData, [
    "market_cap",
    "marketCap",
    "mcap",
    "fdv",
  ]);

  const liquidity = pickNumber(rawData, [
    "liquidity",
    "liquidity_usd",
    "liquidityUsd",
  ]);

  const createdAt =
    row.created_at ??
    new Date().toISOString();

  return {
    id: row.id,
    opportunityType: normalizeOpportunityType(
      row.opportunity_type
    ),
    assetId,
    token,
    symbol,
    title:
      toStringValue(row.title) ??
      `${symbol} opportunity`,
    chain: normalizeChain(row.chain),
    sourceAgent:
      toStringValue(row.source_agent) ??
      "AlphaOS",
    confidence: Math.max(
      0,
      Math.min(100, Math.round(confidence))
    ),
    riskScore: Math.max(
      0,
      Math.min(100, Math.round(riskScore))
    ),
    riskLevel: normalizeRiskLevel(
      riskScore,
      rawData
    ),
    status: normalizeStatus(row.status),
    expectedProfit:
      toNumber(row.expected_profit) ??
      pickNumber(rawData, [
        "expected_profit",
        "expectedProfit",
      ]),
    expectedProfitPercent:
      toNumber(row.expected_profit_percent) ??
      pickNumber(rawData, [
        "expected_profit_percent",
        "expectedProfitPercent",
        "expected_roi",
        "expectedRoi",
      ]),
    entryPrice:
      toNumber(row.entry_price) ??
      pickNumber(rawData, [
        "entry_price",
        "entryPrice",
        "price",
      ]),
    exitPrice:
      toNumber(row.exit_price) ??
      pickNumber(rawData, [
        "exit_price",
        "exitPrice",
        "target_price",
        "targetPrice",
      ]),
    marketCap,
    liquidity,
    createdAt,
    updatedAt: row.updated_at,
    reportUrl: buildReportUrl(token),
  };
}

export async function GET(): Promise<
  NextResponse<ApiResponse<OpportunitiesResponse>>
> {
  try {
    const { data, error } = await supabaseAdmin
      .from("opportunities")
      .select(
        `
          id,
          opportunity_type,
          asset_id,
          chain,
          source_agent,
          title,
          entry_price,
          exit_price,
          expected_profit,
          expected_profit_percent,
          risk_score,
          confidence,
          status,
          raw_data,
          created_at,
          updated_at
        `
      )
      .in("status", [
        "NEW",
        "WATCHING",
        "APPROVED",
        "new",
        "watching",
        "approved",
      ])
      .order("created_at", {
        ascending: false,
      })
      .limit(12);

    if (error) {
      console.error(
        "Live opportunities query failed:",
        error
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Unable to load live opportunities",
        },
        {
          status: 500,
        }
      );
    }

    const items = (
      (data ?? []) as OpportunityRow[]
    ).map(normalizeOpportunity);

    return NextResponse.json({
      success: true,
      data: {
        items,
        total: items.length,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error(
      "Live opportunities module failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load live opportunities",
      },
      {
        status: 500,
      }
    );
  }
}