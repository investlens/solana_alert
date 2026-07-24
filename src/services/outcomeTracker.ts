import { supabase } from "./supabase.js";

const TRACK_INTERVAL_MS = 60_000;
const REQUEST_DELAY_MS = 150;
const ACTIVE_MAX_AGE_HOURS = 24;
const RUG_THRESHOLD_PERCENT = -90;

type OutcomeRow = {
  id: string;
  alert_id: string;
  chain: string | null;
  token_address: string;
  pair_address: string | null;
  symbol: string | null;

  entry_price: number | string;
  current_price: number | string;
  highest_price: number | string;
  lowest_price: number | string;

  roi_current: number | string | null;
  roi_peak: number | string | null;
  roi_low: number | string | null;
  max_drawdown: number | string | null;

  status: string;
  alerted_at: string;
  highest_price_at: string | null;
  lowest_price_at: string | null;
  last_checked_at: string | null;
};

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  priceUsd?: string | null;
  liquidity?: {
    usd?: number | null;
  } | null;
};

type DexPairResponse = {
  schemaVersion?: string;
  pairs?: DexPair[] | null;
};

let trackerStarted = false;
let trackingCycleRunning = false;

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function calculateRoi(entryPrice: number, price: number): number {
  if (entryPrice <= 0) {
    return 0;
  }

  return ((price - entryPrice) / entryPrice) * 100;
}

function calculateDrawdown(
  highestPrice: number,
  currentPrice: number
): number {
  if (highestPrice <= 0) {
    return 0;
  }

  return ((highestPrice - currentPrice) / highestPrice) * 100;
}

function getAgeHours(alertedAt: string): number {
  const alertedTime = new Date(alertedAt).getTime();

  if (!Number.isFinite(alertedTime)) {
    return 0;
  }

  return (Date.now() - alertedTime) / (1000 * 60 * 60);
}

async function fetchLatestPairPrice(
  chain: string,
  pairAddress: string
): Promise<number | null> {
  const encodedChain = encodeURIComponent(chain);
  const encodedPair = encodeURIComponent(pairAddress);

  const url =
    `https://api.dexscreener.com/latest/dex/pairs/` +
    `${encodedChain}/${encodedPair}`;

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 10_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `DexScreener returned ${response.status} ${response.statusText}`
      );
    }

    const payload = (await response.json()) as DexPairResponse;
    const pair = payload.pairs?.[0];

    if (!pair?.priceUsd) {
      return null;
    }

    const price = Number(pair.priceUsd);

    if (!Number.isFinite(price) || price <= 0) {
      return null;
    }

    return price;
  } finally {
    clearTimeout(timeout);
  }
}

async function completeOutcome(
  outcome: OutcomeRow,
  status: "COMPLETED" | "RUGGED" | "DEAD" | "EXPIRED",
  nowIso: string
): Promise<void> {
  const { error } = await supabase
    .from("alert_outcomes")
    .update({
      status,
      completed_at: nowIso,
      last_checked_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", outcome.id);

  if (error) {
    throw new Error(
      `Failed to complete ${outcome.symbol ?? outcome.id}: ${error.message}`
    );
  }
}

async function updateOutcome(outcome: OutcomeRow): Promise<void> {
  const symbol = outcome.symbol ?? outcome.token_address.slice(0, 8);
  const chain = outcome.chain || "solana";
  const nowIso = new Date().toISOString();

  if (!outcome.pair_address) {
    console.warn(
      `[OutcomeTracker] ${symbol}: no pair address. Marking DEAD.`
    );

    await completeOutcome(outcome, "DEAD", nowIso);
    return;
  }

  const ageHours = getAgeHours(outcome.alerted_at);

  if (ageHours >= ACTIVE_MAX_AGE_HOURS) {
    await completeOutcome(outcome, "COMPLETED", nowIso);

    console.log(
      `[OutcomeTracker] ${symbol}: completed after ` +
        `${ageHours.toFixed(1)} hours.`
    );

    return;
  }

  const latestPrice = await fetchLatestPairPrice(
    chain,
    outcome.pair_address
  );

  if (latestPrice === null) {
    console.warn(
      `[OutcomeTracker] ${symbol}: no valid DexScreener price returned.`
    );

    const { error } = await supabase
      .from("alert_outcomes")
      .update({
        last_checked_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", outcome.id);

    if (error) {
      throw new Error(
        `Failed to update check time for ${symbol}: ${error.message}`
      );
    }

    return;
  }

  const entryPrice = toNumber(outcome.entry_price);
  const storedHighest = toNumber(outcome.highest_price);
  const storedLowest = toNumber(outcome.lowest_price);

  if (entryPrice <= 0) {
    console.error(
      `[OutcomeTracker] ${symbol}: invalid entry price ${entryPrice}.`
    );

    await completeOutcome(outcome, "DEAD", nowIso);
    return;
  }

  const nextHighest = Math.max(
    entryPrice,
    storedHighest,
    latestPrice
  );

  const nextLowest = Math.min(
    entryPrice,
    storedLowest > 0 ? storedLowest : entryPrice,
    latestPrice
  );

  const roiCurrent = calculateRoi(entryPrice, latestPrice);
  const roiPeak = calculateRoi(entryPrice, nextHighest);
  const roiLow = calculateRoi(entryPrice, nextLowest);
  const maxDrawdown = calculateDrawdown(
    nextHighest,
    latestPrice
  );

  const isNewHigh = latestPrice > storedHighest;
  const isNewLow =
    storedLowest <= 0 || latestPrice < storedLowest;

  const nextStatus =
    roiCurrent <= RUG_THRESHOLD_PERCENT
      ? "RUGGED"
      : "ACTIVE";

  const updatePayload: Record<string, unknown> = {
    current_price: latestPrice,
    highest_price: nextHighest,
    lowest_price: nextLowest,

    roi_current: roiCurrent,
    roi_peak: roiPeak,
    roi_low: roiLow,
    max_drawdown: maxDrawdown,

    status: nextStatus,
    last_checked_at: nowIso,
    updated_at: nowIso,
  };

  if (isNewHigh) {
    updatePayload.highest_price_at = nowIso;
  }

  if (isNewLow) {
    updatePayload.lowest_price_at = nowIso;
  }

  if (nextStatus === "RUGGED") {
    updatePayload.completed_at = nowIso;
  }

  const { error } = await supabase
    .from("alert_outcomes")
    .update(updatePayload)
    .eq("id", outcome.id);

  if (error) {
    throw new Error(
      `Failed to update ${symbol}: ${error.message}`
    );
  }

  console.log(
    `[OutcomeTracker] ${symbol} | ` +
      `ROI ${roiCurrent.toFixed(2)}% | ` +
      `Peak ${roiPeak.toFixed(2)}% | ` +
      `Drawdown ${maxDrawdown.toFixed(2)}% | ` +
      `${nextStatus}`
  );
}

export async function runOutcomeTrackingCycle(): Promise<void> {
  if (trackingCycleRunning) {
    console.warn(
      "[OutcomeTracker] Previous cycle still running. Skipping."
    );
    return;
  }

  trackingCycleRunning = true;

  try {
    const cycleStartedAt = Date.now();

    const { data, error } = await supabase
      .from("alert_outcomes")
      .select(
        `
          id,
          alert_id,
          chain,
          token_address,
          pair_address,
          symbol,
          entry_price,
          current_price,
          highest_price,
          lowest_price,
          roi_current,
          roi_peak,
          roi_low,
          max_drawdown,
          status,
          alerted_at,
          highest_price_at,
          lowest_price_at,
          last_checked_at
        `
      )
      .eq("status", "ACTIVE")
      .order("alerted_at", { ascending: true })
      .limit(250);

    if (error) {
      throw new Error(
        `Unable to load active outcomes: ${error.message}`
      );
    }

    const outcomes = (data ?? []) as OutcomeRow[];

    console.log(
      `[OutcomeTracker] Starting cycle for ${outcomes.length} active outcomes.`
    );

    let updated = 0;
    let failed = 0;

    for (const outcome of outcomes) {
      try {
        await updateOutcome(outcome);
        updated += 1;
      } catch (error) {
        failed += 1;

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.error(
          `[OutcomeTracker] Failed: ${message}`
        );
      }

      await sleep(REQUEST_DELAY_MS);
    }

    const durationSeconds =
      (Date.now() - cycleStartedAt) / 1000;

    console.log(
      `[OutcomeTracker] Cycle finished | ` +
        `updated=${updated} | ` +
        `failed=${failed} | ` +
        `duration=${durationSeconds.toFixed(1)}s`
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `[OutcomeTracker] Cycle crashed: ${message}`
    );
  } finally {
    trackingCycleRunning = false;
  }
}

export function startOutcomeTracker(): void {
  if (trackerStarted) {
    console.warn(
      "[OutcomeTracker] Tracker already started."
    );
    return;
  }

  trackerStarted = true;

  console.log(
    `[OutcomeTracker] Started. Interval: ` +
      `${TRACK_INTERVAL_MS / 1000} seconds.`
  );

  void runOutcomeTrackingCycle();

  setInterval(() => {
    void runOutcomeTrackingCycle();
  }, TRACK_INTERVAL_MS);
}