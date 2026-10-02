import { launchSocialEligibility } from './alertEligibilityState.js';
import { setSharedJson } from '../../services/sharedJsonCache.js';
import { PONS_CONTRACTS } from './ponsContracts.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { isVerifiedSocialMafiaLaunch, resolveSocialMafiaSocials } from './ponsSocialMafiaAlert.js';
import { directTelegramRecipients, readPonsV2Curve } from './ponsNormalAlertFastLane.js';
import { getCreatorHoldingPercent, getPonsPublicContext } from './ponsPublicContext.js';
import { verifySocialContract } from './socialContractConfirmation.js';
import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { advanceSetupTrend, creatorSetupEligible, emptySetupTrend, type SetupTrend } from './tradeSetupEvidence.js';

const MIN_AGE = 30 * 60_000;
const MAX_AGE = 120 * 60_000;
const INTERVAL = 60_000;
const MAX_CANDIDATES = 10;
type Candidate = { launch: PonsLaunch; launchedAt: number; trend: SetupTrend; screenAfter: number };
const candidates = new Map<string, Candidate>();
const deferredAdmissions = new Map<string, PonsLaunch>();
// Forward observations include losses. They are reference-price research,
// never fabricated fills or net trading returns. Nothing is written to DB.
const outcomes = new Map<string, { launch: PonsLaunch; price: number; at: number; checked: number; min: number; max: number }>();
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
console.log(`[TradeSetup] READY enabled=${String(process.env.PONS_TRADE_SETUP_ENABLED ?? 'true').toLowerCase() === 'true'} launchpad=PONS mode=RESEARCH_WATCH minAgeMin=30 maxCandidates=${MAX_CANDIDATES} dbWrites=0`);
const html = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildTradeSetupText(args: { token: string; symbol: string; name: string; age: number; holding: number | null; burned: number | null; recovery: number; depth: number; lowEth: number; fdvUsd: number | null; creator: string; xUrl: string; tgUrl: string; at: number }): string {
  return [
    '🎯 <b>AlphaOS · TRADE SETUP WATCH</b>',
    `<b>${html(args.symbol.slice(0, 24))}</b> · ${html(args.name.slice(0, 64))}`,
    'PONS · Robinchain · Pre-bond', '',
    '<b>CONFIRMED EVIDENCE</b>',
    `FDV  <b>${args.fdvUsd != null && Number.isFinite(args.fdvUsd) ? '$' + args.fdvUsd.toLocaleString('en-US', { maximumFractionDigits: 0 }) : 'Unavailable'}</b> · PONS page snapshot`,
    `Launch age  <b>${Math.floor(args.age)}m</b>`,
    'Identity  <b>Exact CA listed on linked X</b>',
    `Recovery from observed low  <b>+${args.recovery.toFixed(1)}%</b>`,
    'Confirmation  <b>Two consecutive 60s reserve/price increases</b>',
    `Dev holding  <b>${args.holding == null ? 'Unavailable' : `${args.holding.toFixed(2)}%`}</b>`,
    ...(args.burned != null && args.burned > 0 ? [`Verified dev burn  <b>${args.burned.toFixed(2)}%</b>`] : []),
    'Creator transfers  <b>None in scanned evidence</b>',
    `<a href="https://robinhoodchain.blockscout.com/address/${html(args.creator)}">Creator wallet</a> · <a href="${html(args.xUrl)}">X</a> · <a href="${html(args.tgUrl)}">Telegram</a>`, '',
    '<b>EXECUTION &amp; RISK</b>',
    `Curve quote reserve  <b>${args.depth.toFixed(4)} ETH</b>`,
    'Reserve is not a size-specific sell quote.',
    'Holder concentration / linked wallets  <b>Unavailable</b>',
    'Exit quote / slippage  <b>Not verified</b>',
    `Observed low / invalidation reference  <b>${args.lowEth.toPrecision(6)} ETH/token</b>`,
    'Setup fails below that low or if creator moves tokens.',
    'Entry, position size and exit require your own execution check.', '',
    `<code>${html(args.token)}</code>`,
    `Evidence checked ${new Date(args.at).toISOString().slice(11, 19)} UTC`,
    '<i>Research setup · Social ownership unverified · DYOR</i>',
  ].join('\n');
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const [token, item] of candidates) {
      const now = Date.now();
      if (launchSocialEligibility(token, now) === false) { candidates.delete(token); console.log(`[TradeSetup] RELEASE token=${token} reason=SOCIAL_GATE_FAILED`); continue; }
      if (now - item.launchedAt > MAX_AGE) { candidates.delete(token); continue; }
      if (now - item.launchedAt < MIN_AGE) continue;
      try {
        const curve = await readPonsV2Curve(item.launch);
        if (!curve) { Object.assign(item.trend, emptySetupTrend()); continue; }
        if (curve.graduated) { candidates.delete(token); console.log(`[TradeSetup] STOP token=${token} reason=GRADUATED`); continue; }
        const price = Number(curve.quoteReserve) / Number(curve.tokenReserve);
        const depth = Number(curve.quoteReserve) / 1e18;
        if (!advanceSetupTrend(item.trend, { at: Date.now(), price, quoteDepth: depth })) {
          console.log(`[TradeSetup] WAIT token=${token} reason=${item.trend.dip ? 'RECOVERY_NOT_CONFIRMED' : 'NO_OBSERVED_PULLBACK'} confirmations=${item.trend.confirmations}`); continue;
        }
        if (Date.now() < item.screenAfter) continue;
        item.screenAfter = Date.now() + 5 * 60_000;
        const context = await getPonsPublicContext(token, item.launch.factory_address, item.launch.deployer_address);
        const socials = context ? resolveSocialMafiaSocials(context) : null;
        if (!context || !socials) { console.log(`[TradeSetup] BLOCK token=${token} reason=METADATA_SOCIALS_UNAVAILABLE`); continue; }
        const identity = await verifySocialContract({ token, xHandle: socials.xHandle, telegramUrl: socials.telegramUrl });
        if (!identity.confirmed) { console.log(`[TradeSetup] BLOCK token=${token} reason=${identity.reason}`); continue; }
        const [flow, holding] = await Promise.all([
          scanRobinhoodDevTokenFlow(token, item.launch.deployer_address),
          getCreatorHoldingPercent(token, item.launch.deployer_address),
        ]);
        if (!creatorSetupEligible({ status: flow.evidenceStatus, holding, burned: flow.confirmedDevBurnPercent,
          moved: flow.otherDevTransferPercent, scannedAt: flow.scannedAt }, Date.now())) {
          console.log(`[TradeSetup] BLOCK token=${token} reason=CREATOR_EVIDENCE`); continue;
        }
        // Re-read after enrichment: never send a setup that fell below its low
        // while social/creator checks were running.
        const final = await readPonsV2Curve(item.launch);
        if (!final || final.graduated || Date.now() - item.launchedAt > MAX_AGE
          || Date.now() - item.trend.previous!.at > 90_000) continue;
        const finalPrice = Number(final.quoteReserve) / Number(final.tokenReserve);
        if (!Number.isFinite(finalPrice) || finalPrice < price || final.quoteReserve < curve.quoteReserve) continue;
        const text = buildTradeSetupText({ token, symbol: context.symbol, name: context.name,
          age: (Date.now() - item.launchedAt) / 60_000, holding, burned: flow.confirmedDevBurnPercent,
          recovery: (finalPrice / item.trend.low - 1) * 100, depth: Number(final.quoteReserve) / 1e18, lowEth: item.trend.low * 10 ** context.decimals / 1e18, fdvUsd: context.fdvUsd, creator: context.creator, xUrl: socials.xUrl, tgUrl: socials.telegramUrl, at: Date.now() });
        // Retire before sending: an ambiguous Telegram response must not resend
        // to recipients who may already have received the message.
        candidates.delete(token);
        await setSharedJson(`alphaos:setup:evidence:${token}`, { creator: context.creator, holding, rawLow: item.trend.low, curve: item.launch.curve_address, at: Date.now() }, new Date().toISOString(), 2 * 60 * 60_000);
        const delivery = await directTelegramRecipients(text, token, { twitter: socials.xUrl, telegram: socials.telegramUrl, website: null }, true, true);
        if (outcomes.size >= 20) outcomes.delete(outcomes.keys().next().value!);
        outcomes.set(token, { launch: item.launch, price: finalPrice, at: Date.now(), checked: Date.now(), min: finalPrice, max: finalPrice });
        console.log(`[TradeSetup] SENT token=${token} delivered=${delivery.delivered} failed=${delivery.failed}`);
      } catch { console.log(`[TradeSetup] CHECK_FAILED token=${token}`); }
    }
    for (const [token, launch] of deferredAdmissions) {
      if (launchSocialEligibility(token) === false || !isTradeSetupLaunchAdmissible(launch, Date.now(), MAX_AGE)) { deferredAdmissions.delete(token); continue; }
      if (candidates.size >= MAX_CANDIDATES) break;
      deferredAdmissions.delete(token); admitCandidate(launch);
    }
    for (const [token, outcome] of outcomes) {
      const now = Date.now();
      if (now - outcome.checked < 5 * 60_000) continue;
      outcome.checked = now;
      try {
        const curve = await readPonsV2Curve(outcome.launch);
        if (curve?.graduated || now - outcome.at > 65 * 60_000) {
          console.log(`[TradeSetup] OUTCOME_INCOMPLETE token=${token} reason=${curve?.graduated ? 'GRADUATED' : 'EXPIRED'} fillAssumed=false`);
          outcomes.delete(token); continue;
        }
        if (!curve) continue;
        const price = Number(curve.quoteReserve) / Number(curve.tokenReserve);
        if (!Number.isFinite(price) || price <= 0) continue;
        outcome.min = Math.min(outcome.min, price); outcome.max = Math.max(outcome.max, price);
        console.log(`[TradeSetup] FORWARD_OBSERVATION token=${token} minutes=${Math.floor((now - outcome.at) / 60_000)} grossPricePct=${((price / outcome.price - 1) * 100).toFixed(2)} minPct=${((outcome.min / outcome.price - 1) * 100).toFixed(2)} maxPct=${((outcome.max / outcome.price - 1) * 100).toFixed(2)} fillAssumed=false feesSlippageIncluded=false`);
        if (now - outcome.at >= 60 * 60_000) outcomes.delete(token);
      } catch { /* Keep the bounded observation pending, never fabricate a zero. */ }
    }
    console.log(`[TradeSetup] CYCLE candidates=${candidates.size} outcomes=${outcomes.size} max=${MAX_CANDIDATES} dbWrites=0`);
    if (!candidates.size && !outcomes.size && !deferredAdmissions.size && timer) { clearInterval(timer); timer = null; }
  } finally { running = false; }
}

export function queuePonsTradeSetup(launch: PonsLaunch): void {
  if (String(process.env.PONS_TRADE_SETUP_ENABLED ?? 'true').toLowerCase() !== 'true') return;
  const launchedAt = Date.parse(launch.block_timestamp);
  const token = launch.token_address.toLowerCase();
  if (!isTradeSetupLaunchAdmissible(launch, Date.now()) || candidates.has(token)) return;
  for (const key of candidates.keys()) if (launchSocialEligibility(key) === false) candidates.delete(key);
  if (launchSocialEligibility(token) === false) return;
  if (candidates.size >= MAX_CANDIDATES) {
    if (deferredAdmissions.size < 50) deferredAdmissions.set(token, launch);
    console.log(`[TradeSetup] DEFERRED candidates=${candidates.size} pending=${deferredAdmissions.size} token=${token}`); return;
  }
  admitCandidate(launch);
}

// Called only after fresh admission, or promotion of an already-admitted launch.
function admitCandidate(launch: PonsLaunch): void {
  const token = launch.token_address.toLowerCase();
  const launchedAt = Date.parse(launch.block_timestamp);
  deferredAdmissions.delete(token);
  candidates.set(token, { launch, launchedAt, trend: emptySetupTrend(), screenAfter: 0 });
  console.log(`[TradeSetup] WATCH token=${token} minAgeMin=30 maxAgeMin=120`);
  if (!timer) { timer = setInterval(() => { void tick(); }, INTERVAL); timer.unref(); }
}

export function isTradeSetupLaunchAdmissible(launch: PonsLaunch, now: number, maxAge = 5 * 60_000): boolean {
  const age = now - Date.parse(launch.block_timestamp);
  // Live-only admission prevents restart/backfill replay; only registered V2
  // factories with WETH curves have the reserve evidence this version supports.
  return isVerifiedSocialMafiaLaunch(launch, 'PONS') && launch.protocol_version.startsWith('v2')
    && [PONS_CONTRACTS.weth.toLowerCase(), '0x' + '0'.repeat(40)].includes(launch.pair_token_address?.toLowerCase() ?? '')
    && [launch.token_address, launch.curve_address, launch.deployer_address].every(address => typeof address === 'string' && /^0x[a-fA-F0-9]{40}$/.test(address))
    && Number.isFinite(age) && age >= 0 && age <= maxAge;
}

export async function tickTradeSetupForTests() { await tick(); }

export function tradeSetupSchedulingStateForTests() { return { candidates: [...candidates.keys()], deferred: [...deferredAdmissions.keys()] }; }
export function resetTradeSetupSchedulingForTests() { if (timer) clearInterval(timer); timer = null; candidates.clear(); deferredAdmissions.clear(); outcomes.clear(); }
