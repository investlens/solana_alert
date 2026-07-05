import type { DexPair, RiskResult } from '../types.js';
import { getCreatorProfile } from '../profiles/creatorProfile.js';
import type {
  AlphaChecklistItem,
  AlphaInvestigation,
  AlphaSuggestedAction,
  AlphaVerdict,
  ChecklistStatus,
} from '../types/alphaInvestigation.js';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function statusIcon(status: ChecklistStatus) {
  if (status === 'PASS') return '✅';
  if (status === 'WARN') return '⚠️';
  if (status === 'FAIL') return '❌';
  return '❔';
}

function makeChecklistItem(
  label: string,
  status: ChecklistStatus,
  detail: string
): AlphaChecklistItem {
  return { label, status, detail };
}

function getVerdict(result: RiskResult): AlphaVerdict {
  if (result.score >= 88 && result.risk === 'LOW') return 'STRONG_OPPORTUNITY';
  if (result.score >= 72 && result.risk !== 'HIGH') return 'WORTH_WATCHING';
  if (result.score >= 55) return 'HIGH_RISK';
  if (result.score < 35) return 'AVOID';
  return 'INSUFFICIENT_EVIDENCE';
}

function getSuggestedAction(verdict: AlphaVerdict): AlphaSuggestedAction {
  if (verdict === 'STRONG_OPPORTUNITY') return 'INVESTIGATE_FURTHER';
  if (verdict === 'WORTH_WATCHING') return 'MONITOR_CLOSELY';
  if (verdict === 'HIGH_RISK') return 'WAIT_FOR_CONFIRMATION';
  if (verdict === 'AVOID') return 'AVOID';
  return 'HIGH_RISK_SPECULATION';
}

function buildConfidence(result: RiskResult): number {
  let confidence = result.score;

  if (result.marketSafetyLabel === 'GOOD') confidence += 5;
  if (result.marketSafetyLabel === 'RISKY') confidence -= 8;

  if (result.authoritySafetyLabel === 'GOOD') confidence += 5;
  if (result.authoritySafetyLabel === 'RISK') confidence -= 10;

  if (result.liquidityUsd < 6000) confidence -= 8;
  if (result.ageMin < 10) confidence -= 6;
  if (result.volume5m < 1000) confidence -= 5;
  if (result.sells5m > result.buys5m) confidence -= 7;

  return clamp(Math.round(confidence), 1, 99);
}

function getChecklist(result: RiskResult): AlphaChecklistItem[] {
  const buySellRatio =
    result.sells5m > 0 ? result.buys5m / result.sells5m : result.buys5m > 0 ? 99 : 0;

  return [
    makeChecklistItem(
      'Liquidity',
      result.liquidityUsd >= 6000 ? 'PASS' : 'FAIL',
      `$${Math.round(result.liquidityUsd).toLocaleString()} liquidity`
    ),
    makeChecklistItem(
      'Market Activity',
      result.volume5m >= 3000 ? 'PASS' : result.volume5m >= 1000 ? 'WARN' : 'FAIL',
      `$${Math.round(result.volume5m).toLocaleString()} volume in 5m`
    ),
    makeChecklistItem(
      'Buy Pressure',
      buySellRatio >= 1.4 ? 'PASS' : buySellRatio >= 1 ? 'WARN' : 'FAIL',
      `${result.buys5m}/${result.sells5m} buys/sells`
    ),
    makeChecklistItem(
      'Token Age',
      result.ageMin <= 75 ? 'PASS' : result.ageMin <= 120 ? 'WARN' : 'FAIL',
      `${Math.round(result.ageMin)} minutes old`
    ),
    makeChecklistItem(
      'Market Safety',
      result.marketSafetyLabel === 'GOOD'
        ? 'PASS'
        : result.marketSafetyLabel === 'WATCH'
          ? 'WARN'
          : 'FAIL',
      `${result.marketSafetyLabel} market safety`
    ),
    makeChecklistItem(
      'Authority Safety',
      result.authoritySafetyLabel === 'GOOD'
        ? 'PASS'
        : result.authoritySafetyLabel === 'WATCH'
          ? 'WARN'
          : 'FAIL',
      `${result.authoritySafetyLabel} authority safety`
    ),
  ];
}

function buildExecutiveSummary(args: {
  pair: DexPair;
  result: RiskResult;
  verdict: AlphaVerdict;
  confidence: number;
}) {
  const { pair, result, verdict, confidence } = args;
  const symbol = pair.baseToken?.symbol ?? 'Unknown';

  const goodSignals = result.checksGood.slice(0, 3);
  const riskSignals = [...result.checksWarn, ...result.checksBad].slice(0, 2);

  const verdictText = verdict
    .replace(/_/g, ' ')
    .toLowerCase();

  const goodText =
    goodSignals.length > 0
      ? goodSignals.join('; ')
      : 'available market data shows limited positive confirmation';

  const riskText =
    riskSignals.length > 0
      ? riskSignals.join('; ')
      : 'no major risk flags were available from the current dataset';

  return `AlphaOS classifies ${symbol} as ${verdictText} with ${confidence}% confidence. Positive evidence includes ${goodText}. Key risks include ${riskText}. This is a research assessment, not a buy signal.`;
}

export async function buildAlphaInvestigation(args: {
  tokenAddress: string;
  pair: DexPair;
  result: RiskResult;
  creatorWallet?: string | null;
}): Promise<AlphaInvestigation> {
  const { tokenAddress, pair, result } = args;

  const verdict = getVerdict(result);
  const confidence = buildConfidence(result);
  const suggestedAction = getSuggestedAction(verdict);
  const checklist = getChecklist(result);
  const creator = await getCreatorProfile(args.creatorWallet ?? null);

  const evidence = [
    ...result.checksGood,
    result.marketSafetyLabel === 'GOOD'
      ? 'Market safety checks are positive'
      : '',
    result.authoritySafetyLabel === 'GOOD'
      ? 'Authority safety checks are positive'
      : '',
  ].filter(Boolean);

  const warnings = result.checksWarn;
  const risks = result.checksBad;

  return {
    tokenAddress,
    chain: pair.chainId ?? 'solana',
    symbol: pair.baseToken?.symbol ?? 'UNKNOWN',
    name: pair.baseToken?.name ?? 'Unknown Token',
    url: pair.url ?? null,

    verdict,
    confidence,
    suggestedAction,

    executiveSummary: buildExecutiveSummary({
      pair,
      result,
      verdict,
      confidence,
    }),

    checklist,

    market: {
      marketCap: result.marketCap,
      fdv: result.fdv,
      liquidityUsd: result.liquidityUsd,
      volume5m: result.volume5m,
      buys5m: result.buys5m,
      sells5m: result.sells5m,
      ageMin: result.ageMin,
      priceUsd: result.currentPrice,
    },

    safety: {
      marketSafetyScore: result.marketSafetyScore,
      marketSafetyLabel: result.marketSafetyLabel,
      authoritySafetyScore: result.authoritySafetyScore,
      authoritySafetyLabel: result.authoritySafetyLabel,
      mintAuthority: result.mintAuthority,
      freezeAuthority: result.freezeAuthority,
      isMutable: result.isMutable,
    },

    creator,
    evidence,
    risks,
    warnings,

    source: {
      pair,
      rawRiskResult: result,
    },

    createdAt: new Date().toISOString(),
  };
}

export function formatChecklistItemForDebug(item: AlphaChecklistItem) {
  return `${statusIcon(item.status)} ${item.label}: ${item.detail}`;
}