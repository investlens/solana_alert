import { tokenBalancePercent } from '../../services/tokenBalancePercent.js';
import { getPonsFactoryDeployments } from './ponsContracts.js';
import { encodeFunctionData, parseAbi, type Address } from 'viem';
import { requestRobinhoodRpcResilient } from './rpc.js';
import { boundedEvidenceCache } from '../../services/boundedEvidenceCache.js';

export type TelegramPreviewType = 'Group' | 'Channel' | 'Personal account' | 'Type unverified';
export type PonsPublicContext = {
  name: string; symbol: string; creator: string; decimals: number; totalSupplyRaw: bigint;
  logo?: string | null; curveAddress?: string | null; priceUsd?: number | null; fdvUsd: number | null; twitter: string | null; telegram: string | null;
  phase?: number | null; venue?: string | null; poolId?: string | null;
  marketCapUsd?:number|null; volumeTotalUsd?:number|null; curveReserveUsd?:number|null; progressPct?:number|null; createdAt?:number|null;
  volume5mUsd?:number|null; buys5m?:number|null; sells5m?:number|null;
  creatorSales?: {count:number;tokens:number;latestTx:string;observedAt:number};

};

// RSC text records can precede JSON records without a newline. Scan balanced
// JSON payloads rather than assuming one record per line; skip references and text.
function ponsPageRecords(chunks:string[]):Map<string,any> {
  const text=chunks.join(''), records=new Map<string,any>();let consumed=0;
  for(const match of text.matchAll(/([0-9a-f]+):(?=[\[{])/g)) {
    if(match.index!<consumed)continue;
    const start=match.index!+match[0].length;let depth=0,quoted=false,escaped=false;
    for(let i=start;i<text.length;i++){
      const c=text[i];
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{'||c==='[')depth++;
      else if(c==='}'||c===']')depth--;
      if(depth===0){try{records.set(match[1],JSON.parse(text.slice(start,i+1)));consumed=i+1;}catch{}break;}
    }
  }
  return records;
}
const finiteNonnegative=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
// Read server-rendered public metadata, never credentials or social-profile APIs.
export function parsePonsPublicContext(html: string, token: string, factory: string, creator?: string, now=Date.now()): PonsPublicContext | null {
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((.*?)\)<\/script>/gs)) {
    try { const value = JSON.parse(match[1]); if (typeof value[1] === 'string') chunks.push(value[1]); } catch { /* unknown page layout */ }
  }
  const records=ponsPageRecords(chunks);
  const visit = (value: any): PonsPublicContext | null => {
    if (!value || typeof value !== 'object') return null;
    const launch=value.launch;
    if(launch && value.address?.toLowerCase?.()===token.toLowerCase()
      && launch.address?.toLowerCase?.()===token.toLowerCase()
      && launch.factory?.toLowerCase?.()===factory.toLowerCase()
      && /^0x[a-fA-F0-9]{40}$/.test(launch.deployer??'') && !/^0x0{40}$/i.test(launch.deployer)
      && (!creator||launch.deployer.toLowerCase()===creator.toLowerCase())
      && typeof launch.name==='string' && typeof launch.symbol==='string'
      && Number.isInteger(launch.decimals)&&launch.decimals>=0&&launch.decimals<=36
      && Number.isSafeInteger(launch.totalSupply)&&launch.totalSupply>0) {
      const supply=BigInt(launch.totalSupply)*10n**BigInt(launch.decimals);
      const price=finiteNonnegative(launch.priceUsd)&&launch.priceUsd>0?launch.priceUsd:null;
      const circulating=finiteNonnegative(launch.circulatingSupply)&&launch.circulatingSupply<=launch.totalSupply?launch.circulatingSupply:null;
      const mc=price!=null&&circulating!=null?price*circulating:null;
      const ref=typeof value.trades==='string'?value.trades.match(/^\$@([0-9a-f]+)$/)?.[1]:null;
      const trades=ref?records.get(ref):null;
      const items=Array.isArray(trades?.items)?trades.items:null;
      const end=now/1000,start=end-300;
      const complete=items && items.every((t:any)=>typeof t.id==='string'&&finiteNonnegative(t.timestamp)&&t.timestamp<=end
        && finiteNonnegative(t.quoteAmount)&&['buy','sell'].includes(t.side))
        && new Set(items.map((t:any)=>t.id)).size===items.length
        && (trades.nextCursor===null||items.some((t:any)=>t.timestamp<=start));
      const recent=complete?items.filter((t:any)=>t.timestamp>start):null;
      const quoteUsd=finiteNonnegative(launch.quoteUsd)&&launch.quoteUsd>0?launch.quoteUsd:null;
      return {name:launch.name,symbol:launch.symbol.replace(/^\$+/,''),creator:launch.deployer,decimals:launch.decimals,totalSupplyRaw:supply,
        phase:launch.stage==='curve'?0:['dex','graduated'].includes(launch.stage)?1:null,venue:launch.stage==='curve'?'curve':['dex','graduated'].includes(launch.stage)?'dex':null,
        curveAddress:/^0x[a-fA-F0-9]{40}$/.test(launch.curve??'')?launch.curve:null,
        poolId:/^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(launch.poolId??launch.pool??'')?(launch.poolId??launch.pool):null,
        priceUsd:price,marketCapUsd:mc!=null&&Number.isFinite(mc)?mc:null,fdvUsd:price!=null&&Number.isFinite(price*launch.totalSupply)?price*launch.totalSupply:null,
        volumeTotalUsd:finiteNonnegative(launch.volumeUsd)?launch.volumeUsd:null,
        curveReserveUsd:finiteNonnegative(launch.raisedUsd)?launch.raisedUsd:null,
        progressPct:finiteNonnegative(launch.progress)&&launch.progress<=1?launch.progress*100:null,
        createdAt:finiteNonnegative(launch.createdAt)&&launch.createdAt>0&&launch.createdAt<=end?launch.createdAt*1000:null,
        volume5mUsd:recent&&quoteUsd?recent.reduce((sum:number,t:any)=>sum+t.quoteAmount*quoteUsd,0):null,
        buys5m:recent?recent.filter((t:any)=>t.side==='buy').length:null,sells5m:recent?recent.filter((t:any)=>t.side==='sell').length:null,
        creatorSales:parsePonsCreatorSales(items,launch.deployer,now),
        twitter:typeof launch.socials?.twitter==='string'?launch.socials.twitter:null,telegram:typeof launch.socials?.telegram==='string'?launch.socials.telegram:null};
    }
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
  for(const value of records.values()){const result=visit(value);if(result)return result;}
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
export function creatorHoldingPercentFromRaw(balance:bigint,supply:bigint):number|null {
  return tokenBalancePercent(balance,supply);
}
type HoldingEvidence={percent:number;block:string;observedAt:number};
const holdingEvidence=boundedEvidenceCache<HoldingEvidence>(key=>{
  const [token,creator,block]=key.split(':');
  return readCreatorHoldingEvidence(token,creator,block?block as `0x${string}`:undefined);
});
export async function getCreatorHoldingEvidence(token: string, creator: string, blockTag?: `0x${string}`): Promise<HoldingEvidence | null> {
  if(![token,creator].every(value=>/^0x[a-fA-F0-9]{40}$/.test(value)) || /^0x0{40}$/i.test(creator))return null;
  return holdingEvidence(`${token.toLowerCase()}:${creator.toLowerCase()}:${blockTag??''}`);
}
export async function readCreatorHoldingEvidence(token: string, creator: string, blockTag?: `0x${string}`, request:typeof requestRobinhoodRpcResilient=requestRobinhoodRpcResilient): Promise<HoldingEvidence | null> {
  try {
    // Both values come from the same block; identity alone cannot prove holdings.
    const block = blockTag ?? await request({ method: 'eth_blockNumber', params: [] });
    if(!/^0x[0-9a-f]+$/i.test(String(block)))return null;
    const call = (data: string) => request({ method: 'eth_call', params: [{ to: token, data }, block] });
    // Providers have one in-flight slot. Parallel calls can reject one another.
    const balance = await call(encodeFunctionData({ abi, functionName: 'balanceOf', args: [creator as Address] }));
    const supply = await call(encodeFunctionData({ abi, functionName: 'totalSupply' }));
    if(![balance,supply].every(v=>/^0x[0-9a-f]+$/i.test(String(v))))return null;
    const b = BigInt(String(balance)); const s = BigInt(String(supply));
    const percent=creatorHoldingPercentFromRaw(b,s);
    return percent!=null ? {percent,block:BigInt(String(block)).toString(),observedAt:Date.now()} : null;
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
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const evidence=await Promise.race([getCreatorHoldingEvidence(token,creator),
      new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),4_000);})]);
    return evidence?.percent ?? null;
  } finally {if(timer)clearTimeout(timer);}
}

// Only report exact-creator sales present in the current PONS page. Pagination
// never establishes lifetime totals or that the creator has not sold elsewhere.
export function parsePonsCreatorSales(items:unknown,creator:string,now=Date.now()):PonsPublicContext['creatorSales'] {
 if(!Array.isArray(items)||items.length>100||!/^0x[a-f0-9]{40}$/i.test(creator))return undefined;
 const seen=new Set<string>(); let count=0,tokens=0,latest=0,latestTx='';
 for(const t of items){
  if(t?.trader?.toLowerCase?.()!==creator.toLowerCase()||t.side!=='sell')continue;
  if(!/^0x[a-f0-9]{64}$/i.test(t.txHash??'')||typeof t.id!=='string'||!t.id.startsWith(t.txHash+':')
   ||!finiteNonnegative(t.tokenAmount)||t.tokenAmount<=0||!finiteNonnegative(t.timestamp)||t.timestamp<=0||t.timestamp>now/1000)return undefined;
  if(seen.has(t.id))continue;seen.add(t.id);count++;tokens+=t.tokenAmount;
  if(t.timestamp>latest){latest=t.timestamp;latestTx=t.txHash;}
 }
 return count&&Number.isFinite(tokens)?{count,tokens,latestTx,observedAt:now}:undefined;
}
