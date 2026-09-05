export type PonsLiveConfig = {
  liveIntelligenceEnabled: boolean;
  provenDeveloperAlertsEnabled: boolean;
  shadowBuyEnabled: boolean;
  confirmationSeconds: number;
  successfulDeveloperMinPeakMarketCap: number;
};

const enabled = (value: string | undefined) => value === 'true';

export function getPonsLiveConfig(env: NodeJS.ProcessEnv = process.env): PonsLiveConfig {
  const confirmation = Number(env.PONS_PROVEN_DEV_CONFIRMATION_SECONDS ?? 30);
  const minimumPeakMarketCap = Number(env.PONS_SUCCESSFUL_DEV_MIN_PEAK_MC ?? 300_000);
  return {
    liveIntelligenceEnabled: enabled(env.PONS_LIVE_INTELLIGENCE_ENABLED),
    provenDeveloperAlertsEnabled: enabled(env.PONS_PROVEN_DEV_ALERTS_ENABLED),
    shadowBuyEnabled: enabled(env.PONS_PROVEN_DEV_SHADOW_BUY_ENABLED),
    confirmationSeconds: Number.isFinite(confirmation) && confirmation >= 0 ? confirmation : 30,
    successfulDeveloperMinPeakMarketCap: Number.isFinite(minimumPeakMarketCap) && minimumPeakMarketCap >= 0
      ? minimumPeakMarketCap : 300_000,
  };
}
