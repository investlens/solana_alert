import { fetchTopHolders } from '../core/helius.js';

export type HolderRisk = {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  topHolderCount: number;
};

function getAmount(holder: unknown): number {
  if (!holder || typeof holder !== 'object') return 0;

  const h = holder as {
    amount?: number;
    percentage?: number;
    pct?: number;
    percent?: number;
    uiAmount?: number;
  };

  return Number(
    h.percentage ??
      h.pct ??
      h.percent ??
      h.amount ??
      h.uiAmount ??
      0
  );
}

export async function getHolderRisk(
  mintAddress: string
): Promise<HolderRisk> {
  const holders = await fetchTopHolders(mintAddress);

  if (!holders.length) {
    return {
      score: 25,
      level: 'MEDIUM',
      reasons: ['No holder data available'],
      topHolderCount: 0,
    };
  }

  const amounts = holders
    .map(getAmount)
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => b - a);

  if (!amounts.length) {
    return {
      score: 35,
      level: 'MEDIUM',
      reasons: ['Holder data available but concentration could not be calculated'],
      topHolderCount: holders.length,
    };
  }

  const total = amounts.reduce((sum, x) => sum + x, 0);

  const looksLikePercent = total <= 150;

  const toPct = (value: number) =>
    looksLikePercent ? value : (value / total) * 100;

  const top1 = toPct(amounts[0] ?? 0);
  const top3 = toPct(amounts.slice(0, 3).reduce((s, x) => s + x, 0));
  const top5 = toPct(amounts.slice(0, 5).reduce((s, x) => s + x, 0));
  const top10 = toPct(amounts.slice(0, 10).reduce((s, x) => s + x, 0));

  let score = 0;
  const reasons: string[] = [];

  if (top1 >= 30) {
    score += 50;
    reasons.push(`Top holder controls ${top1.toFixed(1)}%`);
  } else if (top1 >= 20) {
    score += 35;
    reasons.push(`Top holder controls ${top1.toFixed(1)}%`);
  } else if (top1 >= 12) {
    score += 20;
    reasons.push(`Top holder concentration elevated at ${top1.toFixed(1)}%`);
  }

  if (top3 >= 50) {
    score += 30;
    reasons.push(`Top 3 holders control ${top3.toFixed(1)}%`);
  } else if (top3 >= 35) {
    score += 18;
    reasons.push(`Top 3 holders concentration elevated at ${top3.toFixed(1)}%`);
  }

  if (top5 >= 65) {
    score += 25;
    reasons.push(`Top 5 holders control ${top5.toFixed(1)}%`);
  } else if (top5 >= 45) {
    score += 15;
    reasons.push(`Top 5 holders concentration elevated at ${top5.toFixed(1)}%`);
  }

  if (top10 >= 80) {
    score += 15;
    reasons.push(`Top 10 holders control ${top10.toFixed(1)}%`);
  }

  score = Math.max(0, Math.min(100, score));

  const level =
    score >= 60 ? 'HIGH' :
    score >= 30 ? 'MEDIUM' :
    'LOW';

  return {
    score,
    level,
    reasons: reasons.length
      ? reasons
      : ['Holder distribution looks acceptable'],
    topHolderCount: holders.length,
  };
}