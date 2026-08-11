import {
  supabase,
} from '../../services/supabase.js';


export type RobinhoodCreatorRiskStatus =
  | 'UNKNOWN'
  | 'WEAK_CREATOR'
  | 'HIGH_RISK'
  | 'SERIAL_DUMPER'
  | 'PROMISING'
  | 'PROVEN_CREATOR'
  | 'GEM_CREATOR';


export type RobinhoodCreatorRiskResult = {
  creatorWallet: string;

  status:
    RobinhoodCreatorRiskStatus;

  score: number;

  launches: number;

  hit50k: number;
  hit100k: number;
  hit250k: number;
  hit500k: number;
  hit1m: number;

  severeCrashes: number;
  catastrophicCrashes: number;

  catastrophicRatePercent:
    number;

  bestPeakMarketCap:
    number;

  suppressAlert:
    boolean;

  priorityAlert:
    boolean;

  reasons:
    string[];
};


function num(
  value: unknown,
): number {
  const n =
    Number(
      value ??
      0,
    );

  return Number.isFinite(n)
    ? n
    : 0;
}


export async function evaluateRobinhoodCreatorRisk(
  creatorWallet: string | null,
): Promise<RobinhoodCreatorRiskResult | null> {
  if (!creatorWallet) {
    return null;
  }


  const wallet =
    creatorWallet
      .trim()
      .toLowerCase();


  const {
    data,
    error,
  } =
    await supabase
      .from(
        'creator_launches',
      )
      .select(`
        crossed_50k,
        crossed_100k,
        crossed_250k,
        crossed_500k,
        crossed_1m,
        severe_crash,
        catastrophic_crash,
        peak_market_cap
      `)
      .eq(
        'chain',
        'robinhood',
      )
      .eq(
        'creator_wallet',
        wallet,
      )
      .limit(
        100,
      );


  if (error) {
    console.error(
      '[RobinhoodCreatorRisk] Lookup failed:',
      {
        creator:
          wallet,

        error:
          error.message,
      },
    );

    return null;
  }


  const rows =
    data ??
    [];


  const launches =
    rows.length;


  const hit50k =
    rows.filter(
      (row: any) =>
        row.crossed_50k,
    ).length;


  const hit100k =
    rows.filter(
      (row: any) =>
        row.crossed_100k,
    ).length;


  const hit250k =
    rows.filter(
      (row: any) =>
        row.crossed_250k,
    ).length;


  const hit500k =
    rows.filter(
      (row: any) =>
        row.crossed_500k,
    ).length;


  const hit1m =
    rows.filter(
      (row: any) =>
        row.crossed_1m,
    ).length;


  const severeCrashes =
    rows.filter(
      (row: any) =>
        row.severe_crash,
    ).length;


  const catastrophicCrashes =
    rows.filter(
      (row: any) =>
        row.catastrophic_crash,
    ).length;


  const catastrophicRatePercent =
    launches > 0
      ? (
          catastrophicCrashes /
          launches
        ) *
        100
      : 0;


  const bestPeakMarketCap =
    rows.length > 0
      ? Math.max(
          ...rows.map(
            (row: any) =>
              num(
                row.peak_market_cap,
              ),
          ),
        )
      : 0;


  let status:
    RobinhoodCreatorRiskStatus =
      'UNKNOWN';


  let score =
    50;


  let suppressAlert =
    false;


  let priorityAlert =
    false;


  const reasons:
    string[] = [];


  /*
   * Strong negative evidence.
   */
  if (
    launches >= 5 &&
    catastrophicCrashes >= 3 &&
    catastrophicRatePercent >= 50 &&
    hit50k === 0
  ) {
    status =
      'SERIAL_DUMPER';

    score =
      5;

    suppressAlert =
      true;

    reasons.push(
      `${catastrophicCrashes}/${launches} launches catastrophically crashed`,
    );

    reasons.push(
      'No tracked launch crossed $50K',
    );
  }


  else if (
    launches >= 3 &&
    catastrophicCrashes >= 2
  ) {
    status =
      'HIGH_RISK';

    score =
      25;

    reasons.push(
      `${catastrophicCrashes} catastrophic historical crashes`,
    );
  }


  else if (
    launches >= 10 &&
    hit50k === 0
  ) {
    status =
      'WEAK_CREATOR';

    score =
      40;

    reasons.push(
      `${launches} launches with no tracked $50K breakout`,
    );
  }


  /*
   * Positive evidence.
   */
  else if (
    hit1m >= 2 ||
    hit500k >= 2
  ) {
    status =
      'GEM_CREATOR';

    score =
      95;

    priorityAlert =
      true;

    reasons.push(
      'Multiple major historical winners',
    );
  }


  else if (
    hit500k >= 1 ||
    hit250k >= 2
  ) {
    status =
      'PROVEN_CREATOR';

    score =
      88;

    priorityAlert =
      true;

    reasons.push(
      'Strong historical market-cap performance',
    );
  }


  else if (
    hit100k >= 1
  ) {
    status =
      'PROMISING';

    score =
      72;

    priorityAlert =
      true;

    reasons.push(
      `${hit100k} previous launch(es) crossed $100K`,
    );
  }


  return {
    creatorWallet:
      wallet,

    status,

    score,

    launches,

    hit50k,
    hit100k,
    hit250k,
    hit500k,
    hit1m,

    severeCrashes,

    catastrophicCrashes,

    catastrophicRatePercent,

    bestPeakMarketCap,

    suppressAlert,

    priorityAlert,

    reasons,
  };
}