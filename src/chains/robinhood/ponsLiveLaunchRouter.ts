import type { ChainMarketSnapshot } from '../shared/types.js';
import { getPonsLiveConfig, type PonsLiveConfig } from './ponsLiveConfig.js';
import { getPonsDeveloperRegistryEntry, shouldIgnorePonsDeveloperEntry, type PonsDeveloperRegistryEntry } from './ponsDeveloperRegistry.js';
import { launchIdentity, type PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { describePonsTelegramError } from './ponsProvenDeveloperTelegram.js';
import { createPonsProvenDeveloperAlert, type PonsProvenDeveloperAlert } from './ponsProvenDeveloperAlert.js';
import { decidePonsShadowLaunch, evaluatePonsProvenDeveloperLaunch, toPonsLiveMarketEvidence, type PonsShadowDecision } from './ponsProvenDeveloperLaunch.js';

export type PonsLiveRouteResult = {
  status: 'IGNORED' | 'NORMAL_PATH' | 'PROVEN_PROCESSED' | 'DUPLICATE';
  reason: string; provenDeveloper: boolean; alert: PonsProvenDeveloperAlert | null;
  decision: PonsShadowDecision | null; developerTier: string; validation: 'PASS' | 'FAIL' | 'NOT_RUN';
  alertDelivery: 'EMITTED' | 'FAILED' | 'DISABLED' | 'NOT_APPLICABLE';
};
export type PonsLiveRouterDependencies = {
  lookupDeveloper(address: string): Promise<PonsDeveloperRegistryEntry | null>;
  loadMarket(tokenAddress: string): Promise<ChainMarketSnapshot | null>;
  emitAlert(alert: PonsProvenDeveloperAlert): Promise<void>;
  emitDecision(decision: PonsShadowDecision): Promise<void>;
  sleep(ms: number): Promise<void>;
  config: PonsLiveConfig;
  log(line: string): void;
};

export function createPonsLiveLaunchRouter(overrides: Partial<PonsLiveRouterDependencies> = {}) {
  const dependencies: PonsLiveRouterDependencies = {
    lookupDeveloper: getPonsDeveloperRegistryEntry,
    loadMarket: async token => {
      const { getRobinhoodMarketSnapshot } = await import('./market.js');
      return getRobinhoodMarketSnapshot(token, { priority: 'HIGH', caller: 'pons_live_proven_dev' });
    },
    emitAlert: async alert => {
      const { deliverPonsProvenDeveloperTelegram } = await import('./ponsProvenDeveloperTelegram.js');
      const result = await deliverPonsProvenDeveloperTelegram(alert);
      if (result.failed > 0) throw new Error(`Telegram delivery failed recipients=${result.failed}`);
    },
    emitDecision: async decision => { console.log(`[PonsLive] SHADOW ${decision.action} reason=${decision.reason}`); },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    config: getPonsLiveConfig(), log: console.log, ...overrides,
  };
  const processed = new Set<string>();

  return async function routePonsLiveLaunch(launch: PonsLaunch): Promise<PonsLiveRouteResult> {
    if (!dependencies.config.liveIntelligenceEnabled) {
      return { status: 'NORMAL_PATH', reason: 'Pons live intelligence is disabled', provenDeveloper: false, alert: null, decision: null, developerTier: 'UNKNOWN', validation: 'NOT_RUN', alertDelivery: 'NOT_APPLICABLE' };
    }
    const identity = launchIdentity(launch);
    if (processed.has(identity)) return { status: 'DUPLICATE', reason: 'launch already handled', provenDeveloper: false, alert: null, decision: null, developerTier: 'UNKNOWN', validation: 'NOT_RUN', alertDelivery: 'NOT_APPLICABLE' };
    processed.add(identity);
    const developer = await dependencies.lookupDeveloper(launch.deployer_address);
    const ignore = shouldIgnorePonsDeveloperEntry(developer);
    if (ignore.ignore && (ignore.tier === 'SCAMMER' || ignore.tier === 'SPAM_LAUNCHER')) {
      dependencies.log(`[PonsLive] ignored deployer=${launch.deployer_address} tier=${ignore.tier} reason=${ignore.reason ?? 'blocked'}`);
      return { status: 'IGNORED', reason: ignore.reason ?? 'blocked developer', provenDeveloper: false, alert: null, decision: null, developerTier: ignore.tier, validation: 'NOT_RUN', alertDelivery: 'NOT_APPLICABLE' };
    }
    const verifiedPeak = developer?.bestVerifiedPeakMarketCap;
    if (!developer || developer.isBlocked || developer.riskTier || verifiedPeak == null
      || !Number.isFinite(verifiedPeak) || verifiedPeak < dependencies.config.successfulDeveloperMinPeakMarketCap) {
      return { status: 'NORMAL_PATH', reason: 'developer follows normal Pons path', provenDeveloper: false, alert: null, decision: null, developerTier: developer?.tier ?? 'UNKNOWN', validation: 'NOT_RUN', alertDelivery: 'NOT_APPLICABLE' };
    }

    const alert = createPonsProvenDeveloperAlert(launch, developer, identity);
    let alertDelivery: PonsLiveRouteResult['alertDelivery'] = 'DISABLED';
    if (dependencies.config.provenDeveloperAlertsEnabled) {
      try { await dependencies.emitAlert(alert); alertDelivery = 'EMITTED'; }
      catch (error) {
        alertDelivery = 'FAILED';
        dependencies.log(`[PonsLive] Telegram alert failed ${describePonsTelegramError(error)}`);
      }
    }
    if (!dependencies.config.shadowBuyEnabled) {
      return { status: 'PROVEN_PROCESSED', reason: 'alert-only mode; shadow buy disabled',
        provenDeveloper: true, alert: dependencies.config.provenDeveloperAlertsEnabled ? alert : null,
        decision: null, developerTier: developer.tier, validation: 'NOT_RUN', alertDelivery };
    }
    const initial = toPonsLiveMarketEvidence(await dependencies.loadMarket(launch.token_address), launch.token_address);
    const validation = evaluatePonsProvenDeveloperLaunch(developer, initial);
    let confirmation = null;
    if (validation.eligibleForConfirmation) {
      await dependencies.sleep(dependencies.config.confirmationSeconds * 1_000);
      confirmation = toPonsLiveMarketEvidence(await dependencies.loadMarket(launch.token_address), launch.token_address);
    }
    const decision = decidePonsShadowLaunch({ launch, developer, initial, confirmation,
      shadowEnabled: dependencies.config.shadowBuyEnabled });
    await dependencies.emitDecision(decision);
    return { status: 'PROVEN_PROCESSED', reason: decision.reason, provenDeveloper: true,
      alert: dependencies.config.provenDeveloperAlertsEnabled ? alert : null, decision,
      developerTier: developer.tier, validation: validation.eligibleForConfirmation ? 'PASS' : 'FAIL', alertDelivery };
  };
}
