import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { getRobinhoodTokenSocials } from './tokenMetadata.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { getDeliverableUsers } from '../../core/delivery.js';

const MIN_X_AGE_DAYS = Math.max(30, Number(process.env.PONS_SOCIAL_MAFIA_MIN_X_AGE_DAYS ?? 183));
const MAX_CONCURRENT = Math.max(1, Math.min(3, Number(process.env.PONS_SOCIAL_MAFIA_CONCURRENCY ?? 1)));
const MAX_QUEUE = Math.max(10, Math.min(250, Number(process.env.PONS_SOCIAL_MAFIA_MAX_QUEUE ?? 80)));
const PROFILE_CACHE_MS = 24 * 60 * 60_000;
const RECIPIENT_CACHE_MS = 5 * 60_000;
const enabled = () => String(process.env.PONS_SOCIAL_MAFIA_ENABLED ?? 'true').toLowerCase() === 'true';

type XProfile = {
  id: string;
  username: string;
  createdAt: string;
  followers: number | null;
};

type ProfileCacheEntry = { expiresAt: number; value: XProfile | null };
const profileCache = new Map<string, ProfileCacheEntry>();
const queue: PonsLaunch[] = [];
const seen = new Set<string>();
let active = 0;
let warnedMissingXCredential = false;
let recipientCacheAt = 0;
let recipientCache = new Set<string>();

function normalize(value: string): string { return value.trim().toLowerCase(); }
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Pending index';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(2)}%`;
}

export function extractXUsername(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^@[A-Za-z0-9_]{1,15}$/.test(raw)) return raw.slice(1);
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['x.com', 'twitter.com'].includes(host)) return null;
    const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
    if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
    if (['i', 'intent', 'share', 'home', 'search'].includes(first.toLowerCase())) return null;
    return first;
  } catch { return null; }
}

async function fetchXProfile(username: string): Promise<XProfile | null> {
  const key = username.toLowerCase();
  const cached = profileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const bearer = String(process.env.X_BEARER_TOKEN ?? '').trim();
  if (!bearer) {
    if (!warnedMissingXCredential) {
      warnedMissingXCredential = true;
      console.warn('[SocialMafia] X_BEARER_TOKEN missing; PONS social-age alerts are dormant.');
    }
    return null;
  }
  try {
    const url = `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=created_at,public_metrics`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      console.warn('[SocialMafia] X profile lookup failed', { username, status: response.status });
      profileCache.set(key, { expiresAt: Date.now() + 5 * 60_000, value: null });
      return null;
    }
    const payload = await response.json() as {
      data?: { id?: string; username?: string; created_at?: string; public_metrics?: { followers_count?: number } };
    };
    const data = payload.data;
    const createdAt = String(data?.created_at ?? '');
    if (!data?.id || !data?.username || !createdAt || !Number.isFinite(Date.parse(createdAt))) {
      profileCache.set(key, { expiresAt: Date.now() + 5 * 60_000, value: null });
      return null;
    }
    const value: XProfile = {
      id: data.id,
      username: data.username,
      createdAt,
      followers: Number.isFinite(Number(data.public_metrics?.followers_count)) ? Number(data.public_metrics?.followers_count) : null,
    };
    profileCache.set(key, { expiresAt: Date.now() + PROFILE_CACHE_MS, value });
    if (profileCache.size > 2_000) profileCache.delete(profileCache.keys().next().value ?? '');
    return value;
  } catch (error) {
    console.warn('[SocialMafia] X profile lookup unavailable', { username, reason: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function xAccountAgeDays(createdAt: string, now = Date.now()): number | null {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created) || created > now) return null;
  return Math.floor((now - created) / 86_400_000);
}

function formatAge(days: number): string {
  if (days < 365) return `${Math.floor(days / 30.44)} months`;
  const years = Math.floor(days / 365.25);
  const months = Math.floor((days - Math.floor(years * 365.25)) / 30.44);
  return months > 0 ? `${years}y ${months}m` : `${years}y`;
}

async function passesHoneypotGate(tokenAddress: string): Promise<{ allowed: boolean; reason: string }> {
  try {
    const response = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${encodeURIComponent(tokenAddress)}`,
      { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(4_000) },
    );
    if (!response.ok) return { allowed: false, reason: `security provider HTTP ${response.status}` };
    const payload = await response.json() as { result?: Record<string, Record<string, unknown>> };
    const result = payload.result ?? {};
    const key = Object.keys(result).find(item => normalize(item) === normalize(tokenAddress));
    const security = key ? result[key] : null;
    if (!security) return { allowed: false, reason: 'honeypot evidence unavailable' };
    if (String(security.is_honeypot ?? '0') === '1') return { allowed: false, reason: 'honeypot flag' };
    if (String(security.cannot_sell_all ?? '0') === '1') return { allowed: false, reason: 'cannot-sell flag' };
    return { allowed: true, reason: 'honeypot/sellability checks passed' };
  } catch (error) {
    return { allowed: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function recipients(): Promise<string[]> {
  if (Date.now() - recipientCacheAt < RECIPIENT_CACHE_MS && recipientCache.size > 0) return [...recipientCache];
  const next = new Set<string>();
  const admin = String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '').trim();
  if (admin) next.add(admin);
  try {
    const users = await getDeliverableUsers();
    for (const user of users) {
      const telegramId = String(user.telegram_id ?? '').trim();
      if (telegramId && !user.is_blocked) next.add(telegramId);
    }
  } catch (error) {
    console.warn('[SocialMafia] recipient refresh failed; using last-good/admin recipients', {
      reason: error instanceof Error ? error.message : String(error),
    });
    for (const id of recipientCache) next.add(id);
  }
  if (next.size > 0) {
    recipientCache = next;
    recipientCacheAt = Date.now();
  }
  return [...recipientCache];
}

async function sendTelegram(chatId: string, text: string, tokenAddress: string, xUrl: string): Promise<void> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) throw new Error('missing Telegram bot token');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [
        [
          { text: '🚀 PONS', url: `https://www.ponsfamily.com/launchpad/${encodeURIComponent(tokenAddress)}` },
          { text: '𝕏 X', url: xUrl },
        ],
        [
          { text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(tokenAddress)}` },
          { text: '📋 Copy CA', callback_data: `COPY_CA_${tokenAddress}` },
        ],
      ] },
    }),
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}`);
}

async function processLaunch(launch: PonsLaunch): Promise<void> {
  const token = normalize(launch.token_address);
  const socials = await getRobinhoodTokenSocials(token).catch(() => ({ twitter: null, telegram: null, website: null }));
  const username = extractXUsername(socials.twitter);
  if (!username) return;

  const profile = await fetchXProfile(username);
  if (!profile) return;
  const ageDays = xAccountAgeDays(profile.createdAt);
  if (ageDays == null || ageDays < MIN_X_AGE_DAYS) {
    console.log('[SocialMafia] X account below age threshold', { token, username: profile.username, ageDays, minimumDays: MIN_X_AGE_DAYS });
    return;
  }

  const honeypot = await passesHoneypotGate(token);
  if (!honeypot.allowed) {
    console.warn('[SocialMafia] BLOCKED', { token, username: profile.username, reason: honeypot.reason });
    return;
  }

  const [market, dev] = await Promise.all([
    getRobinhoodMarketSnapshot(token, { priority: 'HIGH', caller: 'pons_social_mafia', queueWaitTimeoutMs: 750 }).catch(() => null),
    scanRobinhoodDevTokenFlow(token, launch.deployer_address).catch(() => null),
  ]);
  const symbol = String(market?.symbol ?? '').trim().toUpperCase() || 'PONS TOKEN';
  const name = String(market?.name ?? '').trim();
  const marketCap = market?.marketCapUsd ?? market?.fdvUsd ?? null;
  const followerText = profile.followers == null ? 'Unavailable' : profile.followers.toLocaleString('en-US');
  const created = new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const xUrl = `https://x.com/${encodeURIComponent(profile.username)}`;
  const text = [
    '<b>🕶 SOCIAL MAFIA ALERT</b>',
    '',
    `<b>${escapeHtml(symbol)}</b>${name ? ` · ${escapeHtml(name)}` : ''}`,
    'Source  <b>Verified PONS launch</b>',
    `Market cap  <b>${escapeHtml(money(marketCap))}</b>`,
    `Dev holding  <b>${escapeHtml(percent(dev?.devHoldingPercent))}</b>`,
    '',
    '<b>𝕏 Social</b>',
    `Account  <b>@${escapeHtml(profile.username)}</b>`,
    `X age  <b>${escapeHtml(formatAge(ageDays))}</b>`,
    `Created  <b>${escapeHtml(created)}</b>`,
    `Followers  <b>${escapeHtml(followerText)}</b>`,
    '',
    '🛡 Honeypot / sellability  <b>PASSED</b>',
    '',
    `<code>${escapeHtml(token)}</code>`,
    '',
    '⚠️ <b>Established social history is a signal, not a guarantee. DYOR.</b>',
  ].join('\n');

  const chats = await recipients();
  const results = await Promise.allSettled(chats.map(chatId => sendTelegram(chatId, text, token, xUrl)));
  const delivered = results.filter(result => result.status === 'fulfilled').length;
  const failed = results.length - delivered;
  console.log('[SocialMafia] ALERT_RESULT', {
    token, username: profile.username, xAgeDays: ageDays, followers: profile.followers,
    marketCap, devHoldingPercent: dev?.devHoldingPercent ?? null, delivered, failed,
  });
}

function drain(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const launch = queue.shift()!;
    active += 1;
    void processLaunch(launch)
      .catch(error => console.warn('[SocialMafia] screening failed', {
        token: normalize(launch.token_address), reason: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => { active -= 1; drain(); });
  }
}

export function queuePonsSocialMafiaScreen(launch: PonsLaunch): void {
  if (!enabled()) return;
  const token = normalize(launch.token_address);
  if (!token || seen.has(token)) return;
  seen.add(token);
  if (queue.length >= MAX_QUEUE) {
    const dropped = queue.shift();
    if (dropped) seen.delete(normalize(dropped.token_address));
    console.warn('[SocialMafia] queue full; oldest candidate dropped', { queueDepth: queue.length, maxQueue: MAX_QUEUE });
  }
  queue.push(launch);
  drain();
}

export function resetPonsSocialMafiaForTests(): void {
  queue.length = 0;
  seen.clear();
  profileCache.clear();
  recipientCache.clear();
  recipientCacheAt = 0;
  active = 0;
  warnedMissingXCredential = false;
}
