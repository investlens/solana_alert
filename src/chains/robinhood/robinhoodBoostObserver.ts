import { fetchRobinhoodBoosts } from './discovery.js';
import { boostMetadataFallback, resolveBoostMetadata } from './boostMetadataResolver.js';
import { sendTelegramWithMessageId } from '../../services/telegram.js';
import { config } from '../../config.js';
import { getDeliverableUsers } from '../../core/delivery.js';
import { runtimeDeliverableUsers } from '../../services/runtimeSubscriberRegistry.js';
import { getPonsLaunchState } from './ponsLaunchState.js';

const BOOST_INTERVAL_MS = 15_000;
export const BOOSTED_OPPORTUNITY_THRESHOLD = 200;
export const MAJOR_BOOST_THRESHOLD = 500;

type BoostAction = { text: string; callback_data?: string; url?: string };

export function boostNotificationState(totalBoostAmount: number) {
  return totalBoostAmount >= BOOSTED_OPPORTUNITY_THRESHOLD ? 'BOOSTED_OPPORTUNITY' as const : 'BUILDING' as const;
}
export function boostPresentationState(totalBoostAmount: number) {
  return totalBoostAmount >= MAJOR_BOOST_THRESHOLD ? 'MAJOR_BOOST' as const : 'BOOST' as const;
}

const boostTotals = new Map<string, number>();
const acceptedAdminBoostNotifications = new Set<string>();
let boostRecipientCacheAt = 0;
let boostRecipientCache = new Set<string>();
const BOOST_RECIPIENT_CACHE_MS = 5 * 60_000;
let boostObserverStarted = false;
let boostObserverRunning = false;
let boostBaselineReady = false;
let boostBaselinePromise: Promise<boolean> | null = null;
let boostObserverInterval: ReturnType<typeof setInterval> | null = null;

function normalize(value: string): string { return value.trim().toLowerCase(); }
function shortAddress(value: string): string { const v=value.trim(); return v.length>14?`${v.slice(0,8)}…${v.slice(-6)}`:v; }
function money(value: number): string { if(value>=1_000_000)return `$${(value/1_000_000).toFixed(1)}M`; if(value>=1_000)return `$${(value/1_000).toFixed(1)}K`; return `$${value.toFixed(0)}`; }
export function boostFallbackIdentity(tokenAddress:string,totalBoostAmount:number):string{return `${normalize(tokenAddress)}:${totalBoostAmount}`;}
export function recordAcceptedAdminBoostNotification(tokenAddress:string,totalBoostAmount:number):void{acceptedAdminBoostNotifications.add(boostFallbackIdentity(tokenAddress,totalBoostAmount));}

async function boostRecipients(): Promise<string[]> {
  const now = Date.now();
  if (now - boostRecipientCacheAt > BOOST_RECIPIENT_CACHE_MS) {
    const next = new Set<string>();
    if (config.adminTelegramId) next.add(String(config.adminTelegramId));
    for (const user of runtimeDeliverableUsers({ allRealtime: true })) {
      if (user.telegram_id && !user.is_blocked) next.add(String(user.telegram_id));
    }
    try {
      const users = await Promise.race([
        getDeliverableUsers(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('recipient lookup timeout')), 1500)),
      ]);
      for (const user of users) if (user.telegram_id && !user.is_blocked) next.add(String(user.telegram_id));
    } catch (error) {
      console.warn('[RobinhoodBoostObserver] Recipient DB refresh unavailable; using runtime/admin cache', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (next.size) {
      boostRecipientCache = next;
      boostRecipientCacheAt = now;
    }
  }
  if (!boostRecipientCache.size && config.adminTelegramId) boostRecipientCache.add(String(config.adminTelegramId));
  return [...boostRecipientCache];
}

export async function deliverAdminBoostFallback(args:{tokenAddress:string;totalBoostAmount:number;message:string;buttons?:BoostAction[][]},dependencies:{send?:typeof sendTelegramWithMessageId;adminTelegramId?:string;log?:(event:string,details:Record<string,unknown>)=>void}={}):Promise<boolean>{
 const identity=boostFallbackIdentity(args.tokenAddress,args.totalBoostAmount); if(acceptedAdminBoostNotifications.has(identity))return false;
 const log=dependencies.log??((event,details)=>console.log(`[RobinhoodBoostObserver] ${event}`,details));
 const send=dependencies.send??sendTelegramWithMessageId;
 const recipients=dependencies.adminTelegramId ? [dependencies.adminTelegramId] : await boostRecipients();
 if (!recipients.length) return false;
 const results=await Promise.allSettled(recipients.map(chatId=>send(chatId,args.message,args.buttons)));
 const delivered=results.filter(r=>r.status==='fulfilled').length;
 const failed=results.length-delivered;
 if(delivered>0){acceptedAdminBoostNotifications.add(identity);log('BOOST_DELIVERED',{token:normalize(args.tokenAddress),totalBoost:args.totalBoostAmount,delivered,failed});return true;}
 log('BOOST_DELIVERY_FAILED',{token:normalize(args.tokenAddress),totalBoost:args.totalBoostAmount,delivered,failed});
 return false;
}
export function resetRobinhoodBoostFallbackForTests():void{acceptedAdminBoostNotifications.clear();}


type CustomLiquidityDecision = {
  allowed: boolean;
  status: 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN';
  reason: string;
};

function numericPercent(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function burnLikeLpHolder(holder: Record<string, unknown>): boolean {
  const address = String(holder.address ?? holder.token_account ?? '').toLowerCase();
  const tag = String(holder.tag ?? '').toLowerCase();
  return address === '0x0000000000000000000000000000000000000000'
    || address === '0x000000000000000000000000000000000000dead'
    || tag.includes('burn')
    || tag.includes('dead')
    || tag.includes('null address')
    || tag.includes('black hole');
}

async function checkCustomLiquidityProtection(tokenAddress: string): Promise<CustomLiquidityDecision> {
  const url = `https://api.gopluslabs.io/api/v1/token_security/4663?contract_addresses=${encodeURIComponent(tokenAddress)}`;
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) {
      return { allowed: false, status: 'UNKNOWN', reason: `GoPlus HTTP ${response.status}` };
    }

    const payload = await response.json() as {
      result?: Record<string, Record<string, unknown>>;
      code?: number;
      message?: string;
    };
    const key = normalize(tokenAddress);
    const security = payload.result?.[key]
      ?? payload.result?.[Object.keys(payload.result ?? {}).find(value => normalize(value) === key) ?? ''];
    if (!security) {
      return { allowed: false, status: 'UNKNOWN', reason: 'LP security data unavailable' };
    }

    if (String(security.is_honeypot ?? '0') === '1') {
      return { allowed: false, status: 'UNLOCKED', reason: 'GoPlus honeypot flag' };
    }
    if (String(security.cannot_sell_all ?? '0') === '1') {
      return { allowed: false, status: 'UNLOCKED', reason: 'GoPlus sell restriction flag' };
    }

    const holders = Array.isArray(security.lp_holders)
      ? security.lp_holders as Record<string, unknown>[]
      : [];
    if (!holders.length) {
      return { allowed: false, status: 'UNKNOWN', reason: 'No independently verified LP-holder evidence' };
    }

    let protectedPct = 0;
    let burnedPct = 0;
    let unlockedPct = 0;
    for (const holder of holders) {
      const pct = numericPercent(holder.percent);
      const locked = String(holder.is_locked ?? '0') === '1';
      const burned = burnLikeLpHolder(holder);
      if (locked || burned) protectedPct += pct;
      if (burned) burnedPct += pct;
      if (!locked && !burned) unlockedPct += pct;
    }

    // GoPlus percentages are fractions: 1 = 100%.
    // Custom alerts fail closed unless at least 95% of observed LP is
    // independently protected. This tolerates tiny dust LP positions.
    if (protectedPct >= 0.95) {
      return {
        allowed: true,
        status: burnedPct >= 0.95 ? 'BURNED' : 'LOCKED',
        reason: `${(protectedPct * 100).toFixed(1)}% of observed LP protected`,
      };
    }

    return {
      allowed: false,
      status: 'UNLOCKED',
      reason: `only ${(protectedPct * 100).toFixed(1)}% LP protected; ${(unlockedPct * 100).toFixed(1)}% remains removable`,
    };
  } catch (error) {
    return {
      allowed: false,
      status: 'UNKNOWN',
      reason: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    };
  }
}

type BoostSecurityDecision={status:'SAFE'|'UNKNOWN'|'SCAM';reason:string};
async function checkBoostContractSecurity(tokenAddress:string):Promise<BoostSecurityDecision>{
 const rpcUrl=process.env.ROBINHOOD_RPC_URL?.trim(); if(!rpcUrl)return{status:'UNKNOWN',reason:'security RPC not configured'};
 try{const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),2500);try{const response=await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[tokenAddress,'latest']}),signal:controller.signal});if(!response.ok)return{status:'UNKNOWN',reason:`security RPC HTTP ${response.status}`};const payload=await response.json() as {result?:string;error?:{message?:string}};if(payload.error)return{status:'UNKNOWN',reason:payload.error.message??'security RPC error'};const code=typeof payload.result==='string'?payload.result.toLowerCase():'';if(!code||code==='0x')return{status:'SCAM',reason:'token address has no deployed contract code'};const ascii=Buffer.from(code.slice(2),'hex').toString('latin1').toLowerCase();const marker=['honeypot','blacklisted','blacklist: blocked','trading disabled'].find(v=>ascii.includes(v));if(marker)return{status:'SCAM',reason:`malicious contract marker: ${marker}`};return{status:'SAFE',reason:'deployed contract code verified; no explicit malicious marker found'};}finally{clearTimeout(timeout);}}
 catch(error){return{status:'UNKNOWN',reason:error instanceof Error?error.message.slice(0,180):String(error).slice(0,180)}}
}

async function ensureBoostBaseline():Promise<boolean>{if(boostBaselineReady)return true;if(boostBaselinePromise)return boostBaselinePromise;boostBaselinePromise=(async()=>{try{const boosts=await fetchRobinhoodBoosts();for(const boost of boosts)boostTotals.set(normalize(boost.tokenAddress),boost.totalAmount);boostBaselineReady=true;console.log('[RobinhoodBoostObserver] LIVE_ONLY_BASELINE_READY',{tokens:boosts.length,supabase:'bypassed'});return true;}catch(error){console.error('[RobinhoodBoostObserver] Baseline failed:',error instanceof Error?error.message:String(error));return false;}finally{boostBaselinePromise=null;}})();return boostBaselinePromise;}

export function buildBoostMessage(args:{symbol:string;name?:string|null;tokenAddress:string;boostAmount:number;totalBoostAmount:number;price?:number|null;marketCap?:number|null;fdv?:number|null;liquidity?:number|null;volume5m?:number|null;buys5m?:number|null;sells5m?:number|null;age?:string|null;move?:number|null;momentum?:number|null;confidence?:number|null;risk?:string|null;rawData?:Record<string,unknown>|null;marketContext?:Record<string,unknown>|null;devHoldingPercent:number|null;burnedPercent?:number|null;holderTop1Percent:number|null;eventType:'NEW'|'INCREASE';securityStatus?:'SAFE'|'UNKNOWN'|'SCAM';securityReason?:string}):string{
 const ctx=args.marketContext??{};const mc=typeof ctx.marketCap==='number'?ctx.marketCap:args.marketCap;const fdv=typeof ctx.fdv==='number'?ctx.fdv:args.fdv;const liq=typeof ctx.liquidity==='number'?ctx.liquidity:args.liquidity;const vol=typeof ctx.volume5m==='number'?ctx.volume5m:args.volume5m;const raw=args.rawData??{};const pre=(raw.preIndexValuation&&typeof raw.preIndexValuation==='object'?raw.preIndexValuation:null) as Record<string,unknown>|null;const preValue=pre&&typeof pre.valueUsd==='number'?pre.valueUsd:null;const move=args.move??args.momentum;const security=args.securityStatus??'UNKNOWN';const lines=[`🚀 <b>BOOST DETECTED — ${args.eventType}</b>`,'',`<b>${args.symbol}</b>${args.name?` · ${args.name}`:''}`,'👀 <b>ACTION: WATCH</b>',`Boost  <b>${args.totalBoostAmount} total (+${args.boostAmount})</b>`];if(mc!=null)lines.push(`Market cap  <b>${money(mc)}</b>`);else if(fdv!=null)lines.push(`FDV  <b>${money(fdv)}</b>`);else if(preValue!=null)lines.push(`FDV  <b>${money(preValue)}</b>`);if(liq!=null)lines.push(`Liquidity  <b>${money(liq)}</b>`);if(vol!=null)lines.push(`5m volume  <b>${money(vol)}</b>`);if(move!=null)lines.push(`Move  <b>${move>=0?'+':''}${move.toFixed(1)}%</b>`);if(args.devHoldingPercent!=null)lines.push(`Dev holding  <b>${args.devHoldingPercent}%</b>`);lines.push(security==='SAFE'?'🛡️ Security: contract check passed':security==='SCAM'?'⛔ Security: malicious contract evidence detected':'⚠️ Security: check incomplete — not classified as scam');if(args.securityReason)lines.push(`<i>${args.securityReason}</i>`);lines.push('',`<code>${args.tokenAddress}</code>`,'','Boost is attention evidence, not a buy recommendation.');return lines.join('\n');
}

export function buildBoostActions(args:{tokenAddress:string;chartUrl?:string|null;opportunityId?:number|null;strategyKey?:string|null;rawData?:Record<string,unknown>|null}):BoostAction[][]{
 const token=args.tokenAddress;
 const dex=args.chartUrl || `https://dexscreener.com/robinhood/${encodeURIComponent(token)}`;
 const explorer=`https://robinhoodchain.blockscout.com/token/${encodeURIComponent(token)}`;
 return [
   [
     {text:'🔬 Full Intel',callback_data:`FI_RH_${token}`},
     {text:'📊 Dex',url:dex},
   ],
   [
     {text:'⭐ Track',callback_data:`BOOST_TRACK_${token}`},
     {text:'🔎 Explorer',url:explorer},
   ],
   [
     {text:'📋 Copy CA',callback_data:`COPY_CA_${token}`},
   ],
 ];
}

export async function enrichDeliveredBoostAlert():Promise<number>{return 0;}
export function isMaterialVolumeSurge(args:{previousVolume5m:number|null;currentVolume5m:number|null;previousPrice:number|null;currentPrice:number|null}){return args.previousVolume5m!=null&&args.previousVolume5m>0&&args.currentVolume5m!=null&&args.currentVolume5m>=args.previousVolume5m*1.5&&args.previousPrice!=null&&args.previousPrice>0&&args.currentPrice!=null&&args.currentPrice>=args.previousPrice*0.5;}
export function volumeIgnitionDecision(args:{previousVolume5m:number|null;currentVolume5m:number|null;previousPrice:number|null;currentPrice:number|null;previousLiquidity?:number|null;currentLiquidity?:number|null;buys5m?:number|null;sells5m?:number|null}){const multiple=args.previousVolume5m!=null&&args.previousVolume5m>0&&args.currentVolume5m!=null?args.currentVolume5m/args.previousVolume5m:null;const priceConstructive=args.previousPrice!=null&&args.previousPrice>0&&args.currentPrice!=null&&args.currentPrice>=args.previousPrice*0.5;const liquidityStable=args.previousLiquidity==null||args.currentLiquidity==null||args.previousLiquidity<=0||args.currentLiquidity>=args.previousLiquidity*0.85;const flowConstructive=args.buys5m==null||args.sells5m==null||args.buys5m>=args.sells5m;return{eligible:multiple!=null&&multiple>=1.5&&priceConstructive&&liquidityStable&&flowConstructive,volumeMultiple:multiple};}

async function processBoost(boost:{tokenAddress:string;amount:number;totalAmount:number}):Promise<boolean>{const tokenKey=normalize(boost.tokenAddress);const previousTotal=boostTotals.get(tokenKey);if(previousTotal!=null&&boost.totalAmount<=previousTotal)return false;const eventType:'NEW'|'INCREASE'=previousTotal==null?'NEW':'INCREASE';const boostAdded=previousTotal==null?boost.amount:Math.max(boost.totalAmount-previousTotal,0);const security=await checkBoostContractSecurity(boost.tokenAddress);console.log('[RobinhoodBoostObserver] BOOST_SECURITY_DECISION',{token:tokenKey,status:security.status,reason:security.reason});if(security.status==='SCAM'){boostTotals.set(tokenKey,boost.totalAmount);console.warn('[RobinhoodBoostObserver] BOOST_BLOCKED_SECURITY',{token:tokenKey,totalBoost:boost.totalAmount,reason:security.reason});return false;}const ponsLaunch=await getPonsLaunchState(boost.tokenAddress).catch(()=>null);const verifiedPons=Boolean(ponsLaunch?.exists);const liquidityProtection:CustomLiquidityDecision=verifiedPons?{allowed:true,status:'LOCKED',reason:'verified PONS launchpad; launchpad liquidity protection applies'}:await checkCustomLiquidityProtection(boost.tokenAddress);console.log('[RobinhoodBoostObserver] CUSTOM_LP_DECISION',{token:tokenKey,status:liquidityProtection.status,allowed:liquidityProtection.allowed,reason:liquidityProtection.reason,verifiedPons});if(!liquidityProtection.allowed){boostTotals.set(tokenKey,boost.totalAmount);console.warn('[RobinhoodBoostObserver] BOOST_BLOCKED_LP_CONTROL',{token:tokenKey,totalBoost:boost.totalAmount,status:liquidityProtection.status,reason:liquidityProtection.reason,verifiedPons});return false;}const metadata=await resolveBoostMetadata(boost.tokenAddress,null,500).catch(()=>boostMetadataFallback(boost.tokenAddress));const fallback=boostMetadataFallback(boost.tokenAddress);const symbol=metadata.symbol??fallback.symbol??shortAddress(boost.tokenAddress);const message=buildBoostMessage({symbol,name:metadata.name,tokenAddress:boost.tokenAddress,boostAmount:boostAdded,totalBoostAmount:boost.totalAmount,devHoldingPercent:null,holderTop1Percent:null,eventType,securityStatus:security.status,securityReason:`${security.reason}; LP ${liquidityProtection.status}: ${liquidityProtection.reason}`});const sent=await deliverAdminBoostFallback({tokenAddress:boost.tokenAddress,totalBoostAmount:boost.totalAmount,message,buttons:buildBoostActions({tokenAddress:boost.tokenAddress})});if(sent||acceptedAdminBoostNotifications.has(boostFallbackIdentity(boost.tokenAddress,boost.totalAmount))){boostTotals.set(tokenKey,boost.totalAmount);console.log('[RobinhoodBoostObserver] BOOST_ALERT_VERIFIED',{token:tokenKey,eventType,boostAdded,totalBoost:boost.totalAmount,security:security.status,supabase:'bypassed'});return true;}return false;}

export async function runRobinhoodBoostObserverCycle():Promise<void>{if(boostObserverRunning)return;boostObserverRunning=true;try{if(!await ensureBoostBaseline())return;const boosts=await fetchRobinhoodBoosts();console.log('[RobinhoodBoostObserver] Feed:',{boosts:boosts.length,mode:'LIVE_ONLY'});let alertsSent=0;for(const boost of boosts){try{if(await processBoost(boost))alertsSent+=1;}catch(error){console.error('[RobinhoodBoostObserver] Token processing failed:',{token:boost.tokenAddress,error:error instanceof Error?error.message:String(error)});}}console.log('[RobinhoodBoostObserver] Cycle complete:',{alertsSent,supabase:'bypassed'});}catch(error){console.error('[RobinhoodBoostObserver] Cycle failed:',error instanceof Error?error.message:String(error));}finally{boostObserverRunning=false;}}
export function startRobinhoodBoostObserver():ReturnType<typeof setInterval>|null{if(boostObserverStarted)return boostObserverInterval;boostObserverStarted=true;console.log('[RobinhoodBoostObserver] Starting LIVE_ONLY security-only path...');void ensureBoostBaseline();boostObserverInterval=setInterval(()=>void runRobinhoodBoostObserverCycle(),BOOST_INTERVAL_MS);return boostObserverInterval;}

// Railway deploy sync: BOOST/PONS LP routing fix active.
