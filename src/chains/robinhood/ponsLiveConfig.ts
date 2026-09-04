export type PonsLiveConfig = {
  liveIntelligenceEnabled: boolean;
  provenDeveloperAlertsEnabled: boolean;
  shadowBuyEnabled: boolean;
  confirmationSeconds: number;
};

const enabled = (value: string | undefined) => value === 'true';

export function getPonsLiveConfig(env: NodeJS.ProcessEnv = process.env): PonsLiveConfig {
  const confirmation = Number(env.PONS_PROVEN_DEV_CONFIRMATION_SECONDS ?? 30);
  return {
    liveIntelligenceEnabled: enabled(env.PONS_LIVE_INTELLIGENCE_ENABLED),
    provenDeveloperAlertsEnabled: enabled(env.PONS_PROVEN_DEV_ALERTS_ENABLED),
    shadowBuyEnabled: enabled(env.PONS_PROVEN_DEV_SHADOW_BUY_ENABLED),
    confirmationSeconds: Number.isFinite(confirmation) && confirmation >= 0 ? confirmation : 30,
  };
}
