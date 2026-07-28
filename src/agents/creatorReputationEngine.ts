import { supabase } from '../services/supabase.js';

type CreatorLaunch = {
  creator_wallet: string | null;
  token: string;
  symbol: string | null;
  launched_at: string | null;
};

type TokenOutcome = {
  token: string;
  alert_market_cap: number | null;
  peak_market_cap: number | null;

  return_5m_pct: number | null;
  return_15m_pct: number | null;
  return_30m_pct: number | null;
  return_1h_pct: number | null;
  return_6h_pct: number | null;
  return_24h_pct: number | null;

  max_return_pct: number | null;
  final_outcome: string | null;
  outcome: string | null;
  tracking_complete: boolean | null;
};

type CreatorAggregate = {
  creatorWallet: string;
  launches: CreatorLaunch[];
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function strongestCreatorStatus(
  calculatedStatus: string,
  existingStatus?: string | null
) {
  const priority: Record<string, number> = {
    NEW: 1,
    WATCH: 2,
    RISKY: 2,
    PROMISING: 3,
    PROVEN: 4,
  };

  const calculatedPriority =
    priority[calculatedStatus] ?? 0;

  const existingPriority =
    priority[String(existingStatus ?? '').toUpperCase()] ?? 0;

  return existingPriority > calculatedPriority
    ? String(existingStatus).toUpperCase()
    : calculatedStatus;
}

function calculateCreatorStatus(args: {
  trustScore: number;
  trackedLaunches: number;
  winningLaunches: number;
  failedLaunches: number;
  bestReturnPct: number;
}) {
  const {
    trustScore,
    trackedLaunches,
    winningLaunches,
    failedLaunches,
    bestReturnPct,
  } = args;

  if (
    trackedLaunches >= 3 &&
    winningLaunches >= 2 &&
    trustScore >= 80
  ) {
    return 'PROVEN';
  }

  if (
    winningLaunches >= 1 &&
    bestReturnPct >= 100 &&
    trustScore >= 65
  ) {
    return 'PROMISING';
  }

  if (
    trackedLaunches >= 3 &&
    failedLaunches / trackedLaunches >= 0.7
  ) {
    return 'RISKY';
  }

  if (trackedLaunches > 0) {
    return 'WATCH';
  }

  return 'NEW';
}

function calculateTrustScore(args: {
  totalLaunches: number;
  trackedLaunches: number;
  winningLaunches: number;
  failedLaunches: number;
  moonshots: number;
  successRate: number;
  averageMaxReturn: number;
  bestReturnPct: number;
}) {
  const {
    totalLaunches,
    trackedLaunches,
    winningLaunches,
    failedLaunches,
    moonshots,
    successRate,
    averageMaxReturn,
    bestReturnPct,
  } = args;

  let score = 50;

  if (trackedLaunches >= 2) score += 4;
  if (trackedLaunches >= 5) score += 5;
  if (trackedLaunches >= 10) score += 4;

  if (winningLaunches >= 1) score += 8;
  if (winningLaunches >= 2) score += 7;
  if (winningLaunches >= 4) score += 5;

  if (moonshots >= 1) score += 12;
  if (moonshots >= 2) score += 6;

  if (successRate >= 60) score += 10;
  else if (successRate >= 40) score += 5;
  else if (trackedLaunches >= 3 && successRate < 20) score -= 12;

  if (averageMaxReturn >= 100) score += 8;
  else if (averageMaxReturn >= 50) score += 4;

  if (bestReturnPct >= 300) score += 8;
  else if (bestReturnPct >= 100) score += 4;

  if (trackedLaunches >= 3) {
    const failureRate = failedLaunches / trackedLaunches;

    if (failureRate >= 0.8) score -= 25;
    else if (failureRate >= 0.6) score -= 15;
    else if (failureRate >= 0.4) score -= 7;
  }

  if (totalLaunches >= 15 && winningLaunches === 0) {
    score -= 15;
  }

  return Math.round(clamp(score));
}

function isWinningOutcome(outcome: string | null) {
  return [
    'WINNER',
    'STRONG_WINNER',
    'MOONSHOT',
    'POSITIVE',
  ].includes(String(outcome ?? '').toUpperCase());
}

function isFailedOutcome(outcome: string | null) {
  return [
    'FAILED',
    'RUG',
    'DEAD',
    'SPIKE_AND_DUMP',
  ].includes(String(outcome ?? '').toUpperCase());
}

async function loadCreatorLaunches(): Promise<CreatorLaunch[]> {
  const { data, error } = await supabase
    .from('creator_launches')
    .select('creator_wallet, token, symbol, launched_at')
    .not('creator_wallet', 'is', null)
    .order('launched_at', { ascending: false })
    .limit(5000);

  if (error) {
    console.log('creator reputation launch fetch error:', error.message);
    return [];
  }

  return (data ?? []) as CreatorLaunch[];
}

async function loadTokenOutcomes(tokens: string[]): Promise<TokenOutcome[]> {
  if (!tokens.length) return [];

  const outcomes: TokenOutcome[] = [];

  const chunkSize = 200;

  for (let index = 0; index < tokens.length; index += chunkSize) {
    const chunk = tokens.slice(index, index + chunkSize);

    const { data, error } = await supabase
      .from('token_memory')
      .select(`
        token,
        alert_market_cap,
        peak_market_cap,
        return_5m_pct,
        return_15m_pct,
        return_30m_pct,
        return_1h_pct,
        return_6h_pct,
        return_24h_pct,
        max_return_pct,
        final_outcome,
        outcome,
        tracking_complete
      `)
      .in('token', chunk);

    if (error) {
      console.log('creator reputation outcome fetch error:', error.message);
      continue;
    }

    const sortedData = (data ?? []).sort((a, b) => {
      return Number(Boolean(b.tracking_complete))
          - Number(Boolean(a.tracking_complete));
    });

    outcomes.push(...(sortedData as TokenOutcome[]));

  }

  return outcomes;
}

function groupByCreator(launches: CreatorLaunch[]) {
  const creators = new Map<string, CreatorAggregate>();

  for (const launch of launches) {
    if (!launch.creator_wallet) continue;

    const existing = creators.get(launch.creator_wallet);

    if (existing) {
      existing.launches.push(launch);
      continue;
    }

    creators.set(launch.creator_wallet, {
      creatorWallet: launch.creator_wallet,
      launches: [launch],
    });
  }

  return [...creators.values()];
}

export async function runCreatorReputationEngine() {
  const launches = await loadCreatorLaunches();

  if (!launches.length) {
    console.log('creator reputation engine: no launches');
    return;
  }

  const uniqueTokens = [...new Set(launches.map((launch) => launch.token))];
  const outcomes = await loadTokenOutcomes(uniqueTokens);

  const outcomeByToken = new Map(
    outcomes.map((outcome) => [outcome.token, outcome])
  );

  const creators = groupByCreator(launches);

  console.log('creator reputation engine checking:', creators.length);

  for (const creator of creators) {
    const { data: existingCreator, error: existingCreatorError } =
      await supabase
        .from('proven_creators')
        .select(
          `
          status,
          trust_score,
          best_market_cap,
          reputation_summary
          `
        )
        .eq('creator_wallet', creator.creatorWallet)
        .maybeSingle();

    if (existingCreatorError) {
      console.log(
        'existing creator lookup failed:',
        existingCreatorError.message
      );
    }

    console.log("Creator lookup:", {
      creatorWallet: creator.creatorWallet,
      existingCreator,
    });


    const tracked = creator.launches
      .map((launch) => ({
        launch,
        outcome: outcomeByToken.get(launch.token),
      }))
      .filter(
        (
          item
        ): item is {
          launch: CreatorLaunch;
          outcome: TokenOutcome;
        } => Boolean(item.outcome)
      );

    const muu = tracked.find(
      ({ launch }) =>
        launch.token === "T4jnL2TRXLfD7KUXxyLLrgGBpCauX1cMHVMpHSXpump"
    );

    if (muu) {
      console.log("===== FOUND MUU =====");
      console.log(muu.outcome);
    }

    const completed = tracked.filter(
      ({ outcome }) =>
        outcome.tracking_complete ||
        Boolean(outcome.final_outcome) ||
        Boolean(outcome.outcome)
    );

    console.log("DEBUG Completed:", {
      creator: creator.creatorWallet,
      tracked: tracked.length,
      completed: completed.length,
      completedTokens: completed.map(x => ({
        token: x.launch.token,
        outcome: x.outcome.outcome,
        final: x.outcome.final_outcome,
        tracking: x.outcome.tracking_complete
      }))
    });

    const winningLaunches = completed.filter(({ outcome }) =>
      isWinningOutcome(outcome.final_outcome ?? outcome.outcome)
    ).length;

    const failedLaunches = completed.filter(({ outcome }) =>
      isFailedOutcome(outcome.final_outcome ?? outcome.outcome)
    ).length;

    const maxReturns = tracked
      .map(({ outcome }) => num(outcome.max_return_pct))
      .filter((value) => Number.isFinite(value));

    const bestReturnPct = maxReturns.length
      ? Math.max(...maxReturns)
      : 0;

    const averageMaxReturn = maxReturns.length
      ? maxReturns.reduce((sum, value) => sum + value, 0) /
        maxReturns.length
      : 0;

    const moonshots = tracked.filter(
      ({ outcome }) =>
        num(outcome.max_return_pct) >= 300 ||
        String(outcome.final_outcome ?? outcome.outcome).toUpperCase() ===
          'MOONSHOT'
    ).length;

    const trackedLaunches = completed.length;
    const totalLaunches = creator.launches.length;

    const successRate =
      completed.length > 0
        ? (winningLaunches / completed.length) * 100
        : 0;

    const calculatedTrustScore = calculateTrustScore({
      totalLaunches,
      trackedLaunches,
      winningLaunches,
      failedLaunches,
      moonshots,
      successRate,
      averageMaxReturn,
      bestReturnPct,
    });

    const trustScore = Math.max(
      calculatedTrustScore,
      Number(existingCreator?.trust_score ?? 0)
    );

    const calculatedStatus = calculateCreatorStatus({
      trustScore,
      trackedLaunches,
      winningLaunches,
      failedLaunches,
      bestReturnPct,
    });

    const status = strongestCreatorStatus(
      calculatedStatus,
      existingCreator?.status
    );

    const latestLaunch = creator.launches
      .slice()
      .sort(
        (a, b) =>
          new Date(b.launched_at ?? 0).getTime() -
          new Date(a.launched_at ?? 0).getTime()
      )[0];

    const bestMarketCap = Number(
  existingCreator?.best_market_cap ?? 0
);

const marketCapSummary =
  bestMarketCap >= 1_000_000
    ? ` Verified elite creator. Best launch reached £${Math.round(
        bestMarketCap
      ).toLocaleString('en-GB')}.`
    : bestMarketCap >= 500_000
      ? ` Verified reputed creator. Best launch reached £${Math.round(
          bestMarketCap
        ).toLocaleString('en-GB')}.`
      : '';

const outcomeSummary =
  status === 'PROVEN'
    ? completed.length > 0
      ? `${winningLaunches}/${completed.length} completed launches were winners.`
      : `Creator has a verified successful launch history.`
    : status === 'PROMISING'
      ? `At least one strong historical launch detected.`
      : status === 'RISKY'
        ? `${failedLaunches}/${completed.length} completed launches failed.`
        : trackedLaunches > 0
          ? `AlphaOS is tracking ${trackedLaunches} historical launch outcomes.`
          : `Creator outcome history is still being collected.`;

const summary = `${outcomeSummary}${marketCapSummary}`;

    const { error } = await supabase
      .from('proven_creators')
      .upsert(
        {
          creator_wallet: creator.creatorWallet,

          status,
          trust_score: trustScore,

          total_launches: totalLaunches,
          tracked_launches: trackedLaunches,
          winning_launches: winningLaunches,
          failed_launches: failedLaunches,
          moonshots,

          success_rate: successRate,
          average_max_return: averageMaxReturn,
          best_return_pct: bestReturnPct,

          last_token: latestLaunch?.token ?? null,
          last_symbol: latestLaunch?.symbol ?? null,
          last_launch_at: latestLaunch?.launched_at ?? null,

          reputation_summary: summary,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'creator_wallet',
        }
      );

    if (error) {
      console.log('creator reputation upsert error:', {
        creatorWallet: creator.creatorWallet,
        error: error.message,
      });

      continue;
    }

    console.log('creator reputation updated:', {
      creator: creator.creatorWallet,
      status,
      trustScore,
      totalLaunches,
      trackedLaunches,
      winningLaunches,
      failedLaunches,
      bestReturnPct: Number(bestReturnPct.toFixed(1)),
    });
  }
}