import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { assessSnapshot, reserveAiCall } from './core.mjs';
import { collectRailway, explainGemini } from './providers.mjs';

const enabled = process.env.ALPHAOS_AI_WATCHDOG_ENABLED === 'true';
const aiEnabled = process.env.ALPHAOS_AI_EXPLANATIONS_ENABLED === 'true';
const fixture = process.argv.indexOf('--snapshot');
const statePath = process.env.WATCHDOG_STATE_PATH;
const once = process.argv.includes('--once') || fixture !== -1;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

async function stateFromDisk() {
  if (!statePath || process.env.WATCHDOG_PERSISTENT_STATE_CONFIRMED !== 'true') throw new Error('PERSISTENT_STATE_REQUIRED_FOR_AI');
  try {
    const stat = await import('node:fs/promises').then(fs => fs.stat(statePath));
    if (stat.size > 4096) throw new Error('INVALID_STATE');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(state.day) || !Number.isInteger(state.calls) || state.calls < 0 || state.calls > 4 ||
        !Number.isFinite(state.lastCallAt) || (state.incidentKey !== null && !/^[a-f0-9]{64}$/.test(state.incidentKey))) throw new Error('INVALID_STATE');
    return state;
  } catch (error) {
    // Corruption is not a reason to reset a spent budget.
    if (error.code !== 'ENOENT') throw new Error('STATE_UNREADABLE_AI_PAUSED');
    return { day: new Date().toISOString().slice(0, 10), calls: 0 };
  }
}
async function persist(state) {
  const path = resolve(statePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
async function cycle() {
  let snapshot;
  if (fixture !== -1) {
    const path = process.argv[fixture + 1];
    if (!path) throw new Error('SNAPSHOT_PATH_REQUIRED');
    const fs = await import('node:fs/promises');
    if ((await fs.stat(path)).size > 1024 * 1024) throw new Error('SNAPSHOT_TOO_LARGE');
    snapshot = JSON.parse(await readFile(path, 'utf8'));
  } else snapshot = await collectRailway(process.env.WATCHDOG_RAILWAY_PROJECT_TOKEN);
  const report = assessSnapshot(snapshot);
  console.log(JSON.stringify({ event: 'WATCHDOG_REPORT', ...report }));
  if (!aiEnabled || fixture !== -1 || !process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return;
  const prior = await stateFromDisk();
  const reservation = reserveAiCall(prior, report);
  if (!reservation.allowed) {
    if (prior.calls > 0 && JSON.stringify(prior) !== JSON.stringify(reservation.state)) await persist(reservation.state);
    return;
  }
  await persist(reservation.state);
  try {
    const explanation = await explainGemini(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL, report);
    console.log(JSON.stringify({ event: 'WATCHDOG_AI_EXPLANATION', incidentKey: report.incidentKey, ...explanation }));
  } catch { console.warn(JSON.stringify({ event: 'WATCHDOG_AI_UNAVAILABLE', fallback: 'DETERMINISTIC_REPORT_RETAINED' })); }
}

if (!enabled && fixture === -1) {
  console.log('WATCHDOG_DISABLED: separate service only; no network requests or changes.');
} else {
  do {
    try { await cycle(); }
    catch { console.warn('WATCHDOG_MONITOR_UNAVAILABLE: read failed; live alert services are unaffected.'); if (once) process.exitCode = 1; }
    if (once || stopping) break;
    // No overlapping cycles. Five minutes minimum; responsive shutdown.
    for (let remaining = 300; remaining > 0 && !stopping; remaining--) await wait(1000);
  } while (!stopping);
}
