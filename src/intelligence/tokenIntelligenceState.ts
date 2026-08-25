export type TokenIntelligenceState = 'DISCOVERED' | 'FORMING' | 'BUILDING' | 'CONFIRMED' | 'RUNNER' | 'COOLING' | 'WEAKENING' | 'DANGER';
export type IntelligenceObservation = { roi: number; volume5m?: number | null; buys5m?: number | null; sells5m?: number | null; liquidity?: number | null; observedAt: string };
export type IntelligenceRisk = { criticalSecurity?: boolean; confirmedDevSell?: boolean; meaningfulDevTransfer?: boolean; liquidityCritical?: boolean; severeFlowCollapse?: boolean; developerHoldingPercent?: number | null };
export type SustainedIntelligenceConfig = {
  minimumObservations: number; minimumPositiveObservations: number; retainedMoveRatio: number;
  minimumSustainedSeconds: number; volumeAccelerationRatio: number;
  liquidityStableTolerance: number; adverseFactorsForDanger: number;
};
export const DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG: SustainedIntelligenceConfig = {
  minimumObservations: 3, minimumPositiveObservations: 2, retainedMoveRatio: 0.5,
  minimumSustainedSeconds: 30, volumeAccelerationRatio: 1.5,
  liquidityStableTolerance: 0.15, adverseFactorsForDanger: 2,
};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export type SustainedAssessment = { state: TokenIntelligenceState; sustained: boolean; volumeSurge: boolean; liquidityTrend: 'BUILDING' | 'STABLE' | 'FALLING' | 'CRITICAL' | 'UNKNOWN'; reasons: string[] };
export function assessTokenIntelligence(args: { observations: IntelligenceObservation[]; priorState?: TokenIntelligenceState | null; risk?: IntelligenceRisk; config?: Partial<SustainedIntelligenceConfig> }): SustainedAssessment {
  const config = { ...DEFAULT_SUSTAINED_INTELLIGENCE_CONFIG, ...args.config };
  const rows = [...args.observations].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const risk = args.risk ?? {}; const reasons: string[] = [];
  if (!rows.length) return { state: 'DISCOVERED', sustained: false, volumeSurge: false, liquidityTrend: 'UNKNOWN', reasons: ['No comparable observations yet.'] };
  const peak = Math.max(...rows.map(row => row.roi)); const current = rows[rows.length - 1].roi;
  const positiveCount = rows.filter(row => row.roi > 0).length;
  const retained = peak > 0 ? current / peak : 0;
  const oldestAt = Date.parse(rows[0].observedAt); const newestAt = Date.parse(rows[rows.length - 1].observedAt);
  const observationSpanSeconds = Number.isFinite(oldestAt) && Number.isFinite(newestAt)
    ? Math.max(0, (newestAt - oldestAt) / 1000) : 0;
  const sustained = rows.length >= config.minimumObservations &&
    positiveCount >= config.minimumPositiveObservations &&
    observationSpanSeconds >= config.minimumSustainedSeconds &&
    current > 0 && retained >= config.retainedMoveRatio;
  const firstVolume = rows.find(row => finite(row.volume5m) && row.volume5m! > 0)?.volume5m ?? null;
  const currentVolume = rows[rows.length - 1].volume5m;
  const volumeSurge = sustained && finite(firstVolume) && finite(currentVolume) && currentVolume >= firstVolume * config.volumeAccelerationRatio;
  const liquidity = rows.map(row => row.liquidity).filter((value): value is number => finite(value) && value > 0);
  let liquidityTrend: SustainedAssessment['liquidityTrend'] = 'UNKNOWN';
  if (risk.liquidityCritical) liquidityTrend = 'CRITICAL';
  else if (liquidity.length >= 2) { const change = (liquidity[liquidity.length - 1] - liquidity[0]) / liquidity[0]; liquidityTrend = change > config.liquidityStableTolerance ? 'BUILDING' : change < -config.liquidityStableTolerance ? 'FALLING' : 'STABLE'; }
  if (risk.criticalSecurity || risk.confirmedDevSell || risk.liquidityCritical) return { state: 'DANGER', sustained, volumeSurge, liquidityTrend, reasons: ['Explicit critical evidence overrides ordinary volatility.'] };
  if (rows.length === 1) return { state: 'DISCOVERED', sustained, volumeSurge, liquidityTrend, reasons: ['Launch/discovery alone remains internal.'] };
  const sellPressure = rows.length >= 2 && rows.slice(-2).every(row => finite(row.buys5m) && finite(row.sells5m) && row.sells5m! > row.buys5m!);
  const adverse = Number(liquidityTrend === 'FALLING') + Number(risk.severeFlowCollapse || sellPressure) + Number(current <= 0 || retained < config.retainedMoveRatio);
  if (adverse >= config.adverseFactorsForDanger) return { state: 'DANGER', sustained, volumeSurge, liquidityTrend, reasons: ['Multiple independent adverse factors agree.'] };
  if (peak > 0 && current < peak && adverse === 0 && !risk.meaningfulDevTransfer) return { state: 'COOLING', sustained, volumeSurge, liquidityTrend, reasons: ['Move is consolidating while liquidity, flow, and developer evidence remain intact.'] };
  if (adverse === 1 || risk.meaningfulDevTransfer) return { state: 'WEAKENING', sustained, volumeSurge, liquidityTrend, reasons: ['One material adverse factor requires monitoring.'] };
  if (args.priorState === 'CONFIRMED' || args.priorState === 'RUNNER') return { state: sustained ? 'RUNNER' : 'COOLING', sustained, volumeSurge, liquidityTrend, reasons: ['Runner requires prior confirmation and continued sustained structure.'] };
  if (sustained && volumeSurge && ['STABLE', 'BUILDING'].includes(liquidityTrend)) return { state: 'CONFIRMED', sustained, volumeSurge, liquidityTrend, reasons: ['Price retention, participation, and liquidity agree.'] };
  if (sustained) return { state: 'BUILDING', sustained, volumeSurge, liquidityTrend, reasons: ['Positive move persists across multiple observations.'] };
  return { state: rows.length >= 2 ? 'FORMING' : 'DISCOVERED', sustained, volumeSurge, liquidityTrend, reasons: ['Evidence is still forming.'] };
}

export const DEFAULT_DEV_TRANSFER_NOTIFY_PERCENT = 1;
export const DEFAULT_DEV_BURN_NOTIFY_PERCENT: number | null = 1;
export function developerEvent(args: { transferredPercent?: number | null; soldPercent?: number | null; burnedPercent?: number | null; evidence: 'VERIFIED' | 'UNCONFIRMED' | 'UNAVAILABLE'; transferNotifyPercent?: number; burnNotifyPercent?: number | null }) {
  if (args.evidence !== 'VERIFIED') return { type: 'NONE' as const, priority: 'INTERNAL' as const, notify: false };
  if (finite(args.soldPercent) && args.soldPercent > 0) return { type: 'DEV_SELL' as const, priority: 'IMMEDIATE' as const, notify: true };
  if (finite(args.transferredPercent) && args.transferredPercent > 0) { return { type: 'DEV_TRANSFER' as const, priority: 'INTERNAL' as const, notify: false }; }
  if (finite(args.burnedPercent) && args.burnedPercent > 0) { const threshold = args.burnNotifyPercent === undefined ? DEFAULT_DEV_BURN_NOTIFY_PERCENT : args.burnNotifyPercent; const notify = threshold != null && args.burnedPercent >= threshold; return { type: 'DEV_BURN' as const, priority: notify ? 'IMMEDIATE' as const : 'INTERNAL' as const, notify }; }
  return { type: 'DEV_HOLDING' as const, priority: 'INTERNAL' as const, notify: false };
}
