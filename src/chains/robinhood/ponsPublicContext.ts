import { getPonsFactoryDeployments } from './ponsContracts.js';
import { createPublicClient, http, encodeFunctionData, parseAbi, type Address } from 'viem';
import { robinhoodChain } from './config.js';
import { requestRobinhoodRpcResilient } from './rpc.js';

export type TelegramPreviewType = 'Group' | 'Channel' | 'Personal account' | 'Type unverified';
export type PonsPublicContext = {
  name: string; symbol: string; creator: string; decimals: number; totalSupplyRaw: bigint;
  logo?: string | null; curveAddress?: string | null; priceUsd?: number | null; fdvUsd: number | null; twitter: string | null; telegram: string | null;
  phase?: number | null; venue?: string | null; poolId?: string | null;
};

// Read server-rendered public metadata, never credentials or social-profile APIs.
export function parsePonsPublicContext(html: string, token: string, factory: string, creator?: string): PonsPublicContext | null {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try { const value = JSON.parse(match[1]); if (typeof value[1] === 'string') chunks.push(value[1]); } catch { /* unknown page layout */ }
  }
  const visit = (value: any): PonsPublicContext | null => {
    if (!value || typeof value !== 'object') return null;
    const d = value.initialDetails;
    if (d && typeof d.token === 'string' && d.token.toLowerCase() === token.toLowerCase()
      && typeof d.factory === 'string' && d.factory.toLowerCase() === factory.toLowerCase()
      && typeof d.deployer === 'string' && /^0x[a-fA-F0-9]{40}$/.test(d.deployer) && (!creator || d.deployer.toLowerCase() === creator.toLowerCase())
      && /^\d+$/.test(d.totalSupplyWei) && Number.isInteger(d.decimals) && d.decimals >= 0 && d.decimals <= 36
      && typeof d.name === 'string' && typeof d.symbol === 'string') {
      const supply = BigInt(d.totalSupplyWei);
      const price = value.initialPriceQuote; const quoteUsd = value.quoteUsd;
      const fdv = typeof price === 'number' && price > 0 && typeof quoteUsd === 'number' && quoteUsd > 0
        ? price * quoteUsd * Number(supply) / 10 ** d.decimals : null;
      return { name: d.name, symbol: d.symbol.replace(/^\$+/, ''), creator: d.deployer,
        phase: Number.isInteger(d.phase) && d.phase >= 0 ? d.phase : null,
        venue: typeof d.venue === 'string' ? d.venue : null,
        poolId: /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(d.poolId ?? '') ? d.poolId : null,
        curveAddress: /^0x[a-fA-F0-9]{40}$/.test(d.curve ?? d.curveAddress ?? '') ? (d.curve ?? d.curveAddress) : null,
        logo: typeof d.logo === 'string' ? d.logo : null, decimals: d.decimals, totalSupplyRaw: supply,
        priceUsd: typeof price === 'number' && price > 0 && typeof quoteUsd === 'number' && quoteUsd > 0 && Number.isFinite(price * quoteUsd) ? price * quoteUsd : null,
        fdvUsd: fdv != null && Number.isFinite(fdv) ? fdv : null,
        twitter: typeof d.socials?.twitter === 'string' ? d.socials.twitter : null,
        telegram: typeof d.socials?.telegram === 'string' ? d.socials.telegram : null };
    }
    for (const child of Object.values(value)) { const result = visit(child); if (result) return result; }
    return null;
  };
  for (const line of chunks.join('').split('\n')) {
    try { const result = visit(JSON.parse(line.slice(line.indexOf(':') + 1))); if (result) return result; } catch { /* non-JSON RSC record */ }
  }
  return null;
}

const pageCache = new Map<string, { expires: number; html: string | null }>();
const pageInflight = new Map<string, Promise<string | null>>();
// V1 launches go straight to a pool; their page has no V2 factory/curve fields.
// Caller must separately establish V1 provenance. The page supplies mapping only.
export function parsePonsV1PoolMapping(html: string, token: string, creator: string): string | null {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try { const value = JSON.parse(match[1]); if (typeof value[1] === 'string') chunks.push(value[1]); } catch {}
  }
  const visit = (value: any): string | null => {
    if (!value || typeof value !== 'object') return null;
    const d = value.initialDetails;
    if (d?.token?.toLowerCase?.() === token.toLowerCase() && d?.deployer?.toLowerCase?.() === creator.toLowerCase()
      && /^0x[a-fA-F0-9]{40}$/.test(d.pool ?? '') && !/^0x0{40}$/i.test(d.pool)
      && d.venue !== 'curve' && !d.curve && !d.curveAddress) return d.pool;
    for (const child of Object.values(value)) { const result = visit(child); if (result) return result; }
    return null;
  };
  for (const line of chunks.join('').split('\n')) {
    try { const result = visit(JSON.parse(line.slice(line.indexOf(':') + 1))); if (result) return result; } catch {}
  }
  return null;
}
export async function getPonsV1PoolMapping(token: string, creator: string): Promise<string | null> {
  if (![token, creator].every(value => /^0x[a-fA-F0-9]{40}$/.test(value))) return null;
  const html = await publicHtml(`https://www.ponsfamily.com/launchpad/${token}`);
  return html ? parsePonsV1PoolMapping(html, token, creator) : null;
}
async function publicHtml(url: string): Promise<string | null> {
  const cached = pageCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.html;
  const pending = pageInflight.get(url); if (pending) return pending;
  const request = fetchPublicHtml(url); pageInflight.set(url, request);
  try {
    const html = await request;
    if (pageCache.size >= 250) pageCache.delete(pageCache.keys().next().value!);
    pageCache.set(url, { html, expires: Date.now() + (html ? 30_000 : 5_000) });
    return html;
  } finally { pageInflight.delete(url); }
}
export function isSamePonsLaunchRedirect(original: string, target: string): boolean {
  try {
    const a = new URL(original), b = new URL(target);
    return [a,b].every(u => u.protocol === 'https:' && !u.username && !u.password && !u.port
      && ['ponsfamily.com','www.ponsfamily.com'].includes(u.hostname)
      && /^\/launchpad\/0x[a-f0-9]{40}\/?$/i.test(u.pathname))
      && a.pathname.replace(/\/$/,'').toLowerCase() === b.pathname.replace(/\/$/,'').toLowerCase();
  } catch { return false; }
}
export async function fetchPublicHtml(url: string, request: typeof fetch = fetch): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(4_000);
    let current = url;
    let response: Response;
    for (let hop = 0; ; hop++) {
      response = await request(current, { signal, redirect: 'manual', headers: { accept: 'text/html' } });
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location || hop >= 2) return null;
      const target = new URL(location, current).href;
      if (!isSamePonsLaunchRedirect(url, target)) return null;
      current = target;
    }
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
    const reader = response.body?.getReader(); if (!reader) return null;
    const decoder = new TextDecoder(); let html = ''; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
        if (size > 1_000_000) return null; html += decoder.decode(chunk.value, { stream: true }); }
      return html + decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  } catch { return null; }
}

export async function getPonsPublicContext(token: string, factory: string, creator: string): Promise<PonsPublicContext | null> {
  if (![token, factory, creator].every(value => /^0x[a-fA-F0-9]{40}$/.test(value))) return null;
  const html = await publicHtml(`https://www.ponsfamily.com/launchpad/${token}`);
  return html ? parsePonsPublicContext(html, token, factory, creator) : null;
}

export function classifyTelegramPreview(html: string): TelegramPreviewType {
  const extra = html.match(/class="tgme_page_extra"[^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';
  if (/\b[\d, ]+ members\b/i.test(extra)) return 'Group';
  if (/\b[\d, ]+ subscribers\b/i.test(extra)) return 'Channel';
  // A username alone is never evidence that this is a personal account.
  if (/\bSend Message\b/.test(html) && !/\bView in Telegram\b/.test(html)
    && /^@[A-Za-z0-9_]+$/.test(extra) && !/bot$/i.test(extra)) return 'Personal account';
  return 'Type unverified';
}

export async function getTelegramPreviewType(url: string): Promise<TelegramPreviewType> {
  try {
    const parsed = new URL(url);
    if (!['t.me', 'telegram.me', 'telegram.dog'].includes(parsed.hostname) || !/^\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(parsed.pathname)) return 'Type unverified';
    const html = await publicHtml(`https://t.me${parsed.pathname}`);
    return html ? classifyTelegramPreview(html) : 'Type unverified';
  } catch { return 'Type unverified'; }
}

const abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function totalSupply() view returns (uint256)']);
export async function getCreatorHoldingEvidence(token: string, creator: string, blockTag?: `0x${string}`): Promise<{percent:number;block:string;observedAt:number} | null> {
  try {
    // Both values come from the same block; identity alone cannot prove holdings.
    const block = blockTag ?? await requestRobinhoodRpcResilient({ method: 'eth_blockNumber', params: [] });
    const call = (data: string) => requestRobinhoodRpcResilient({ method: 'eth_call', params: [{ to: token, data }, block] });
    const [balance, supply] = await Promise.all([
      call(encodeFunctionData({ abi, functionName: 'balanceOf', args: [creator as Address] })),
      call(encodeFunctionData({ abi, functionName: 'totalSupply' })),
    ]);
    const b = BigInt(String(balance)); const s = BigInt(String(supply));
    return s > 0n && b >= 0n && b <= s ? {percent:Number(b * 1_000_000n / s) / 10_000,block:BigInt(String(block)).toString(),observedAt:Date.now()} : null;
  } catch { return null; }
}

export async function getCreatorHoldingPercent(token: string, creator: string, blockTag?: `0x${string}`): Promise<number | null> {
  return (await getCreatorHoldingEvidence(token,creator,blockTag))?.percent ?? null;
}

// Call only after independent PONS provenance verification; website data never establishes provenance.
export async function getVerifiedPonsPublicContext(token: string, factoryAddress?: string): Promise<PonsPublicContext | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return null;
  const html = await publicHtml(`https://www.ponsfamily.com/launchpad/${token}`);
  if (!html) return null;
  for (const factory of getPonsFactoryDeployments()) {
    if (!factory.enabled || (factoryAddress && factory.address.toLowerCase() !== factoryAddress.toLowerCase())) continue;
    const context = parsePonsPublicContext(html, token, factory.address);
    if (context) return context;
  }
  return null;
}

// Requested research may display exact-contract website metadata with its source
// explicitly labelled. This does NOT verify launch provenance or social ownership.
export async function getReportedPonsPublicContext(token: string): Promise<PonsPublicContext | null> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return null;
  const html = await publicHtml(`https://www.ponsfamily.com/launchpad/${token}`);
  if (!html) return null;
  for (const factory of getPonsFactoryDeployments()) {
    if (!factory.enabled) continue;
    const context = parsePonsPublicContext(html, token, factory.address);
    if (context) return context;
  }
  return null;
}

// Interactive scans have a separate hard deadline and no automatic retries.
// A website-reported creator is an identity claim, not evidence of ownership.
export async function getScreenCreatorBalance(token: string, creator: string): Promise<number | null> {
  if (![token, creator].every(value => /^0x[a-fA-F0-9]{40}$/.test(value))) return null;
  const client = createPublicClient({ chain: robinhoodChain, transport: http(robinhoodChain.rpcUrls.default.http[0], {
    timeout: 2_000, retryCount: 0, fetchOptions: { signal: AbortSignal.timeout(4_000) },
  }) });
  try {
    const blockNumber = await client.getBlockNumber();
    const balance = await client.readContract({ address: token as Address, abi, functionName: 'balanceOf', args: [creator as Address], blockNumber, authorizationList: undefined });
    const supply = await client.readContract({ address: token as Address, abi, functionName: 'totalSupply', blockNumber, authorizationList: undefined });
    return supply > 0n && balance <= supply ? Number(balance) / Number(supply) * 100 : null;
  } catch { return null; }
}
