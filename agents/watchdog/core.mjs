import { createHash } from 'node:crypto';

export const SERVICES = Object.freeze([
  { name: 'main', id: 'ff20240d-fd6c-4584-b05e-5394bdfa06df', scan: /^existing_token_scanner_cycle / },
  { name: 'pons', id: 'a655d7e1-4f12-4c7f-b80e-ed0e0e802e4b', scan: /^\[PonsLive\] factory=/ },
  { name: 'arc', id: 'e127922b-fff0-4799-90b3-810915666516', scan: /^\[ArcLive\] scan / },
]);
export const ENVIRONMENT = '39e74a73-ce54-40b7-82c8-d034d575d678';
export const ACTIONS = Object.freeze(['CHECK_PROVIDER', 'CHECK_SCAN_PROGRESS', 'CHECK_TELEGRAM_ACCEPTANCE', 'CHECK_MONITORING_CREDENTIALS']);

// Raw messages, tokens, wallet addresses and arbitrary provider text never enter this result.
export function assessSnapshot(snapshot, now = Date.now()) {
  const evidence = [];
  for (const service of SERVICES) {
    const sample = snapshot[service.name];
    const add = (kind, details = {}) => evidence.push({ id: `${service.name}:${kind}`, service: service.name, kind, ...details });
    if (!sample || sample.error) { add('MONITORING_UNAVAILABLE'); continue; }
    if (!sample.deployment || sample.deployment.status !== 'SUCCESS') {
      add('DEPLOYMENT_NOT_SUCCESS'); continue;
    }
    const logs = Array.isArray(sample.logs) ? sample.logs.slice(-200) : [];
    if (sample.truncated) { add('MONITORING_UNAVAILABLE'); continue; }
    const recent = logs.filter(row => {
      const time = Date.parse(row.timestamp);
      return Number.isFinite(time) && time <= now + 30_000 && time >= now - 10 * 60_000 && typeof row.message === 'string';
    });
    const latestScan = recent.filter(row => service.scan.test(row.message)).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    if (!latestScan) add('SCAN_EVIDENCE_MISSING');
    else if (now - Date.parse(latestScan.timestamp) > 3 * 60_000) add('SCAN_STALE');
    // Do not count cumulative httpTimeout counters as new incidents.
    const timeouts = recent.filter(row => /aborted due to timeout|request timed out|request took too long|ETIMEDOUT/i.test(row.message)).length;
    if (timeouts >= 3) add('REPEATED_TIMEOUTS', { count: timeouts });
    const deliveryFailures = recent.filter(row => /\[(?:AlphaSemanticDelivery|WalletActivity|TelegramDelivery)\].*delivery failed|Ephemeral Telegram delivery failed/i.test(row.message)).length;
    if (deliveryFailures) add('DELIVERY_FAILURE', { count: deliveryFailures });
  }
  return { observedAt: new Date(now).toISOString(), scope: 'SAMPLED_DEPLOYMENT_AND_SCAN_LOGS',
    deliveryHealth: 'NOT_ESTABLISHED_WITHOUT_FRESH_ACCEPTANCE_EVIDENCE', evidence,
    status: evidence.length ? 'NEEDS_REVIEW' : 'SCANS_OBSERVED',
    incidentKey: createHash('sha256').update(JSON.stringify(evidence.map(({ id, kind }) => ({ id, kind })))).digest('hex') };
}

export function aiInput(report) {
  return { scope: report.scope, deliveryHealth: report.deliveryHealth, evidence: report.evidence };
}

export function validateExplanation(value, report) {
  if (!value || !Array.isArray(value.evidenceIds) || !value.evidenceIds.length || value.evidenceIds.length > 12 ||
      !ACTIONS.includes(value.nextCheck) || typeof value.hypothesis !== 'string' ||
      !['PROVIDER_FAILURE_POSSIBLE', 'SCAN_PROGRESS_UNVERIFIED', 'DELIVERY_FAILURE_OBSERVED', 'MONITOR_ACCESS_UNAVAILABLE'].includes(value.hypothesis)) return null;
  const ids = new Set(report.evidence.map(item => item.id));
  if (!value.evidenceIds.every(id => typeof id === 'string' && ids.has(id))) return null;
  const cited = report.evidence.filter(item => value.evidenceIds.includes(item.id));
  const pair = {
    PROVIDER_FAILURE_POSSIBLE: ['REPEATED_TIMEOUTS', 'CHECK_PROVIDER'],
    SCAN_PROGRESS_UNVERIFIED: ['SCAN_STALE', 'SCAN_EVIDENCE_MISSING', 'DEPLOYMENT_NOT_SUCCESS', 'CHECK_SCAN_PROGRESS'],
    DELIVERY_FAILURE_OBSERVED: ['DELIVERY_FAILURE', 'CHECK_TELEGRAM_ACCEPTANCE'],
    MONITOR_ACCESS_UNAVAILABLE: ['MONITORING_UNAVAILABLE', 'CHECK_MONITORING_CREDENTIALS'],
  }[value.hypothesis];
  if (value.nextCheck !== pair.at(-1) || !cited.some(item => pair.slice(0, -1).includes(item.kind))) return null;
  return { hypothesis: value.hypothesis, nextCheck: value.nextCheck, evidenceIds: [...new Set(value.evidenceIds)] };
}

export function reserveAiCall(state, report, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (state.day !== day) state = { ...state, day, calls: 0 };
  if (!report.evidence.length) return { allowed: false, state: { ...state, incidentKey: null } };
  if (report.evidence.every(item => item.kind === 'MONITORING_UNAVAILABLE') ||
      state.calls >= 4 || state.incidentKey === report.incidentKey ||
      (state.lastCallAt && now - state.lastCallAt < 30 * 60_000)) return { allowed: false, state };
  // Persist before invoking the provider: failed calls consume the budget too.
  return { allowed: true, state: { ...state, day, calls: (state.calls ?? 0) + 1, incidentKey: report.incidentKey, lastCallAt: now } };
}
