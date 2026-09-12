import { getRobinhoodMarketSnapshot } from '../market.js';
import { getPonsLaunchState } from '../ponsLaunchState.js';
import { supabase } from '../../../services/supabase.js';
import { runRobinhoodSecurityGate } from './securityGate.js';
import { scanRobinhoodDexPaid } from './dexPaidScanner.js';
import { scanRobinhoodAdminRisk } from './adminRiskScanner.js';
import { scanRobinhoodPoolSecurity } from './poolSecurityScanner.js';
import { scanPonsSellability } from './sellabilityScanner.js';
import { scanRobinhoodHolderRisk, type RobinhoodHolderRiskResult } from './holderRiskScanner.js';
import { scanRobinhoodDevHolding, type RobinhoodDevHoldingResult } from './devHoldingScanner.js';
import { scanRobinhoodDevMovement, type RobinhoodDevMovementResult } from './devMovementScanner.js';
import { scanRobinhoodBundleIntelligence, type RobinhoodBundleIntelligenceResult } from './bundleIntelligence.js';

const MAX_MARKET_CAP_USD = Number(process.env.DEX_PAID_MAX_MARKET_CAP_USD ?? 15_000);
const MIN_LIQUIDITY_USD = Number(process.env.DEX_PAID_MIN_LIQUIDITY_USD ?? 2_500);
const MAX_PAIR_AGE_MINUTES = Number(process.env.DEX_PAID_MAX_PAIR_AGE_MINUTES ?? 30);
const MAX_PAYMENT_AGE_SECONDS = Number(process.env.DEX_PAID_MAX_PAYMENT_AGE_SECONDS ?? 120);
const MAX_TOP1_PERCENT = Number(process.env.DEX_PAID_MAX_TOP1_PERCENT ?? 15);
const MAX_DEV_HOLDING_PERCENT = Number(process.env.DEX_PAID_MAX_DEV_HOLDING_PERCENT ?? 20);
const MAX_SELL_IMPACT_PERCENT = Number(process.env.DEX_PAID_MAX_SELL_IMPACT_PERCENT ?? 20);

type GateCheck = { key: string; passed: boolean; detail: string };
export type DexPaidAlertSafetyResult = {
  allowed: boolean; reasons: string[]; checks: GateCheck[];
  marketCapUsd: number | null; liquidityUsd: number | null; pairAgeMinutes: number | null;
  paymentAgeSeconds: number | null; sellImpactPercent: number | null; ponsDeployer: string | null;
};

type SecuritySnapshotInput = DexPaidAlertSafetyResult & {
  tokenAddress: string;
  holder: RobinhoodHolderRiskResult | null;
  devHolding: RobinhoodDevHoldingResult | null;
  devMovement: RobinhoodDevMovementResult | null;
  bundle: RobinhoodBundleIntelligenceResult | null;
  evidence: Record<string, unknown>;
};

function finite(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }
function push(checks: GateCheck[], reasons: string[], key: string, passed: boolean, detail: string) {
  checks.push({ key, passed, detail }); if (!passed) reasons.push(`${key}: ${detail}`);
}
function timestampMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

async function persistSecuritySnapshot(input: SecuritySnapshotInput): Promise<void> {
  try {
    const { error } = await supabase.from('robinhood_dex_paid_security_snapshots').insert({
      token_address: input.tokenAddress.toLowerCase(),
      allowed: input.allowed,
      market_cap_usd: input.marketCapUsd,
      liquidity_usd: input.liquidityUsd,
      pair_age_minutes: input.pairAgeMinutes,
      payment_age_seconds: input.paymentAgeSeconds,
      sell_impact_percent: input.sellImpactPercent,
      pons_deployer: input.ponsDeployer?.toLowerCase() ?? null,
      holder_risk: input.holder?.concentrationRisk ?? null,
      holder_top1_pct: input.holder?.top1Pct ?? null,
      holder_top5_pct: input.holder?.top5Pct ?? null,
      holder_top10_pct: input.holder?.top10Pct ?? null,
      holder_count_observed: input.holder?.holderCountObserved ?? null,
      circulating_holder_count: input.holder?.circulatingHolderCountObserved ?? null,
      dev_holding_percent: input.devHolding?.holdingPercent ?? null,
      dev_movement_status: input.devMovement?.status ?? null,
      dev_moved_percent: input.devMovement?.movedPercentOfSupply ?? null,
      dev_destination_count: input.devMovement?.destinations.length ?? null,
      bundle_level: input.bundle?.level ?? null,
      bundle_score: input.bundle?.score ?? null,
      bundle_evidence_available: input.bundle?.evidenceAvailable ?? null,
      bundle_connected_wallet_count: input.bundle?.connectedWallets.length ?? null,
      bundle_connected_supply_pct: input.bundle?.metrics.connectedCurrentSupplyPct ?? null,
      checks: input.checks,
      reasons: input.reasons,
      evidence: input.evidence,
      source: 'DEX_PAID_ALERT_SAFETY_GATE_V2',
    });
    if (error) console.warn('[DexPaidSafetyEvidence] persist failed', { tokenAddress: input.tokenAddress, error: error.message });
  } catch (error) {
    console.warn('[DexPaidSafetyEvidence] persist failed', {
      tokenAddress: input.tokenAddress,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function evaluateDexPaidAlertSafety(tokenAddress: string): Promise<DexPaidAlertSafetyResult> {
  const checks: GateCheck[] = []; const reasons: string[] = [];
  try {
    const [market, dexPaid, contractGate, adminRisk, launch] = await Promise.all([
      getRobinhoodMarketSnapshot(tokenAddress, { priority: 'HIGH', caller: 'dex_paid_alert_safety' }),
      scanRobinhoodDexPaid(tokenAddress), runRobinhoodSecurityGate(tokenAddress), scanRobinhoodAdminRisk(tokenAddress),
      getPonsLaunchState(tokenAddress).catch(() => null),
    ]);
    const marketCap = finite(market?.marketCapUsd); const liquidity = finite(market?.liquidityUsd);
    const pairCreatedAt = finite(market?.pairCreatedAt);
    const pairAgeMinutes = pairCreatedAt != null ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : null;
    const paymentAt = timestampMs(dexPaid.latestPaymentTimestamp);
    const paymentAgeSeconds = paymentAt != null ? Math.max(0, (Date.now() - paymentAt) / 1000) : null;

    push(checks, reasons, 'DEX_PAID_CONFIRMED', dexPaid.status === 'PAID' && dexPaid.dexPaid === true,
      dexPaid.status === 'PAID' ? 'paid DexScreener order confirmed' : `status=${dexPaid.status}`);
    push(checks, reasons, 'PAYMENT_FRESHNESS', paymentAgeSeconds != null && paymentAgeSeconds <= MAX_PAYMENT_AGE_SECONDS,
      paymentAgeSeconds == null ? 'payment timestamp unavailable' : `${paymentAgeSeconds.toFixed(0)}s old; max ${MAX_PAYMENT_AGE_SECONDS}s`);
    push(checks, reasons, 'MARKET_CAP', marketCap != null && marketCap > 0 && marketCap <= MAX_MARKET_CAP_USD,
      marketCap == null ? 'market cap unavailable' : `$${marketCap.toFixed(0)} must be <= $${MAX_MARKET_CAP_USD}`);
    push(checks, reasons, 'NEW_LAUNCH', pairAgeMinutes != null && pairAgeMinutes <= MAX_PAIR_AGE_MINUTES,
      pairAgeMinutes == null ? 'pair age unavailable' : `${pairAgeMinutes.toFixed(1)}m old; max ${MAX_PAIR_AGE_MINUTES}m`);
    push(checks, reasons, 'LIQUIDITY', liquidity != null && liquidity >= MIN_LIQUIDITY_USD,
      liquidity == null ? 'liquidity unavailable' : `$${liquidity.toFixed(0)}; min $${MIN_LIQUIDITY_USD}`);
    push(checks, reasons, 'CONTRACT', contractGate.allowed && contractGate.security.decision === 'PASS',
      `decision=${contractGate.security.decision}, score=${contractGate.security.score}`);
    const dangerousAdminSignals = adminRisk.signals.filter(signal => signal.detected && (signal.severity === 'HIGH' || signal.severity === 'CRITICAL'));
    push(checks, reasons, 'ADMIN_CONTROLS', dangerousAdminSignals.length === 0,
      dangerousAdminSignals.length ? dangerousAdminSignals.map(signal => signal.id).join(', ') : 'no high/critical control indicators');
    const isVerifiedPonsLaunch = Boolean(launch?.exists);
    push(checks, reasons, 'DEV_LINK', isVerifiedPonsLaunch,
      isVerifiedPonsLaunch ? `PONS deployer ${launch!.deployer}` : 'verified PONS deployer unavailable');

    let poolEvidence: Record<string, unknown> | null = null;
    if (!market || !market.pairAddress) push(checks, reasons, 'POOL', false, 'verified pair unavailable');
    else {
      const pool = await scanRobinhoodPoolSecurity({ tokenAddress, pairAddress: market.pairAddress });
      poolEvidence = { blockers: pool.blockers, poolBytecodeExists: pool.poolBytecodeExists };
      push(checks, reasons, 'POOL', pool.blockers.length === 0 && pool.poolBytecodeExists !== false,
        pool.blockers.length ? pool.blockers.join('; ') : 'pool contract verified');
    }

    let sellImpact: number | null = null;
    let sellabilityEvidence: Record<string, unknown> | null = null;
    if (isVerifiedPonsLaunch) {
      const sellability = await scanPonsSellability(tokenAddress); sellImpact = finite(sellability.estimatedImpactPercent);
      sellabilityEvidence = { status: sellability.status, sellable: sellability.sellable, estimatedImpactPercent: sellImpact, warnings: sellability.warnings };
      const sellPass = sellability.sellable === true && sellability.status === 'SELLABLE' && (sellImpact == null || sellImpact <= MAX_SELL_IMPACT_PERCENT);
      push(checks, reasons, 'SELLABILITY', sellPass, `status=${sellability.status}${sellImpact == null ? '' : `, impact=${sellImpact.toFixed(1)}%`}`);
    } else push(checks, reasons, 'SELLABILITY', false, 'sell route cannot be verified as PONS');

    const holder = await scanRobinhoodHolderRisk(tokenAddress, { poolAddress: market?.pairAddress ?? null, timeoutMs: 2_750 });
    const holderPass = holder.concentrationRisk !== 'HIGH' && holder.concentrationRisk !== 'UNKNOWN' && holder.top1Pct != null && holder.top1Pct <= MAX_TOP1_PERCENT;
    push(checks, reasons, 'HOLDER_CONCENTRATION', holderPass,
      `risk=${holder.concentrationRisk}, top1=${holder.top1Pct == null ? 'unknown' : `${holder.top1Pct.toFixed(1)}%`}`);

    let devHolding: RobinhoodDevHoldingResult | null = null;
    let devMovement: RobinhoodDevMovementResult | null = null;
    let bundle: RobinhoodBundleIntelligenceResult | null = null;
    if (isVerifiedPonsLaunch) {
      [devHolding, devMovement] = await Promise.all([scanRobinhoodDevHolding(tokenAddress), scanRobinhoodDevMovement(tokenAddress)]);
      const holdingPass = devHolding.holdingPercent != null && devHolding.holdingPercent <= MAX_DEV_HOLDING_PERCENT;
      push(checks, reasons, 'DEV_HOLDING', holdingPass,
        devHolding.holdingPercent == null ? 'dev holding unavailable' : `${devHolding.holdingPercent.toFixed(1)}%; max ${MAX_DEV_HOLDING_PERCENT}%`);

      bundle = await scanRobinhoodBundleIntelligence(tokenAddress, {
        poolAddress: market?.pairAddress ?? null,
        devMovement,
      });
      const bundlePass = bundle.evidenceAvailable && bundle.level !== 'HIGH' && bundle.level !== 'UNKNOWN';
      push(checks, reasons, 'ROBINHOOD_BUNDLE', bundlePass,
        `level=${bundle.level}, score=${bundle.score}, ${bundle.reasons.join('; ')}`);

      const movementPass = devMovement.status === 'NO_MOVEMENT' || devMovement.burned === true;
      push(checks, reasons, 'DEV_MOVEMENT', movementPass, `status=${devMovement.status}${devMovement.burned ? ', burn-only' : ''}`);
    } else {
      push(checks, reasons, 'ROBINHOOD_BUNDLE', false, 'verified deployer unavailable for bundle analysis');
    }

    const result: DexPaidAlertSafetyResult = { allowed: reasons.length === 0, reasons, checks, marketCapUsd: marketCap, liquidityUsd: liquidity,
      pairAgeMinutes, paymentAgeSeconds, sellImpactPercent: sellImpact, ponsDeployer: launch?.exists ? String(launch.deployer) : null };

    void persistSecuritySnapshot({
      ...result,
      tokenAddress,
      holder,
      devHolding,
      devMovement,
      bundle,
      evidence: {
        market: { pairAddress: market?.pairAddress ?? null, pairCreatedAt: market?.pairCreatedAt ?? null },
        dexPaid: { status: dexPaid.status, dexPaid: dexPaid.dexPaid, latestPaymentTimestamp: dexPaid.latestPaymentTimestamp },
        contract: { allowed: contractGate.allowed, decision: contractGate.security.decision, score: contractGate.security.score },
        admin: { dangerousSignals: dangerousAdminSignals.map(signal => ({ id: signal.id, severity: signal.severity })) },
        pool: poolEvidence,
        sellability: sellabilityEvidence,
        holder: { warnings: holder.warnings, excludedAddresses: holder.excludedAddresses, scannedAt: holder.scannedAt },
        devHolding: devHolding ? { status: devHolding.status, warnings: devHolding.warnings, scannedAt: devHolding.scannedAt } : null,
        devMovement: devMovement ? { transferCount: devMovement.transferCount, burned: devMovement.burned, moved: devMovement.moved, sold: devMovement.sold, warnings: devMovement.warnings, scannedAt: devMovement.scannedAt } : null,
        bundle: bundle ? { reasons: bundle.reasons, metrics: bundle.metrics, scannedAt: bundle.scannedAt } : null,
      },
    });

    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const result: DexPaidAlertSafetyResult = { allowed: false, reasons: [`SAFETY_GATE_ERROR: ${reason}`], checks: [{ key: 'SAFETY_GATE_ERROR', passed: false, detail: reason }],
      marketCapUsd: null, liquidityUsd: null, pairAgeMinutes: null, paymentAgeSeconds: null, sellImpactPercent: null, ponsDeployer: null };
    void persistSecuritySnapshot({ ...result, tokenAddress, holder: null, devHolding: null, devMovement: null, bundle: null, evidence: { gateError: reason } });
    return result;
  }
}
