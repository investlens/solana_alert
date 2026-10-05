import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { addressKey, finiteNumber, recordedMarket, object, textValue, validDate, type RecordRow } from '@/lib/dashboard/recorded-market';
import type { LaunchVenue } from '@/lib/dashboard/market-provenance';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{token: string}>; searchParams: Promise<Record<string,string|string[]|undefined>> };
const chains = ['robinhood','arc','solana','ethereum','base','bsc','sui'];
const one = (v: string|string[]|undefined) => Array.isArray(v) ? v[0] : v;
const money = (v: number|null) => v === null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:2}).format(v);
const price = (v: number|null) => v === null ? '—' : v === 0 ? '$0' : v < 0.000001 ? `$${v.toExponential(5)}` : `$${v.toLocaleString('en-US',{maximumSignificantDigits:8})}`;
const timestamp = (v: string|null) => v ? new Date(v).toISOString().replace('T',' ').replace('.000Z',' UTC').replace(/\.\d+Z$/,' UTC') : 'Unknown';
export default async function IntelligencePage({params,searchParams}: Props) {
  const {token} = await params, query = await searchParams;
  const decoded = addressKey(token), requestedChain = one(query.chain)?.toLowerCase();
  const invalidChain = !!requestedChain && !chains.includes(requestedChain);
  let lookup = supabaseAdmin.from('opportunities')
    .select('asset_id,chain,source_agent,risk_score,confidence,status,raw_data,created_at,updated_at')
    .eq('asset_id',decoded).order('created_at',{ascending:false}).limit(12);
  if (requestedChain && !invalidChain) lookup = lookup.eq('chain',requestedChain);
  const result = invalidChain ? {data:null,error:{message:'Unsupported chain'}}
    : await lookup.abortSignal(AbortSignal.timeout(3500));
  const candidates = (result.data ?? []) as RecordRow[];
  const ambiguous = !requestedChain && (decoded.startsWith('0x') || new Set(candidates.map(row=>row.chain)).size > 1);
  const row = !ambiguous && !result.error ? candidates[0] : undefined;
  const chain = row?.chain ?? requestedChain ?? 'unknown';
  let launch: LaunchVenue|undefined, launchFailed = false;
  if (row && chain === 'robinhood') {
    const response = await supabaseAdmin.from('pons_launches')
      .select('token_address,chain,protocol_version,curve_address,pool_address')
      .eq('chain',chain).eq('token_address',decoded).limit(1)
      .abortSignal(AbortSignal.timeout(3500)).maybeSingle();
    launch = response.data as LaunchVenue|undefined;
    launchFailed = !!response.error;
  }
  const market = row ? recordedMarket(row,launch,launchFailed) : null;
  const raw = object(row?.raw_data);
  const symbol = market?.identityMatches ? textValue(raw.symbol ?? raw.token_symbol ?? raw.ticker) ?? 'TOKEN' : 'TOKEN';
  const name = market?.identityMatches ? textValue(raw.name) ?? symbol : symbol;
  // Alert baseline is kept separate and constrained to the same token AND chain.
  // No lifetime peak, old liquidity or memory price is spliced into this snapshot.
  let alertPrice: number|null = null, alertedAt: string|null = null;
  if (row) {
    const alerts = await supabaseAdmin.from('alerts').select('alert_price,alerted_at')
      .eq('token_address',decoded).eq('chain',chain)
      .order('alerted_at',{ascending:false}).limit(1)
      .abortSignal(AbortSignal.timeout(3500)).maybeSingle();
    if (!alerts.error) {
      const value = finiteNumber(alerts.data?.alert_price);
      alertedAt = validDate(alerts.data?.alerted_at);
      if (value !== null && value > 0 && alertedAt) alertPrice = value;
    }
  }
  const facts = [
    ['MARKET CAP',money(market?.marketCap ?? null)],
    ['RECORDED PRICE',price(market?.price ?? null)],
    ['LIQUIDITY',money(market?.liquidity ?? null)],
    ['5M VOLUME',money(market?.volume5m ?? null)],
    ['BUYS / SELLS',`${market?.buys5m ?? '—'} / ${market?.sells5m ?? '—'}`],
    ['OBSERVED PEAK MC',money(market?.peakMarketCap ?? null)],
  ];
  const risk = market?.riskLevel ?? 'UNKNOWN';
  const score = market?.confidence ?? null;
  const scoreColor = score === null ? 'text-zinc-400' : score < 35 ? 'text-rose-300' : score < 70 ? 'text-amber-300' : 'text-emerald-300';
  const venueUrl = market?.venuePending && market.launchpad === 'PONS'
    ? `https://www.ponsfamily.com/launchpad/${decoded}` : market?.chartUrl;
  return <AppShell><main className="px-4 pb-28 pt-5 text-white sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"><div className="mx-auto max-w-[1100px]">
    <div className="flex items-center justify-between"><Link href="/" className="text-xs text-zinc-500">← Home</Link><Link href="/opportunities" className="text-xs text-zinc-400">Research terminal →</Link></div>
    <section className="mt-5 rounded-3xl border border-white/[0.09] bg-[#171b1f] p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5"><div>
        <div className="flex gap-2"><span className="rounded-full border border-white/10 px-2.5 py-1 text-[9px] text-zinc-300">{chain.toUpperCase()}{market?.launchpad ? ` · ${market.launchpad}` : ''}</span><span className="rounded-full border border-white/10 px-2.5 py-1 text-[9px] text-zinc-300">{market?.state ?? 'UNAVAILABLE'}</span></div>
        <p className="mt-5 text-[10px] tracking-[0.18em] text-zinc-500">ALPHAOS RECORDED RESEARCH</p><h1 className="mt-1 text-4xl font-semibold">{symbol}</h1><p className="mt-1 text-sm text-zinc-500">{name}</p><p className="mt-2 break-all font-mono text-[10px] text-zinc-500">{decoded}</p>
      </div><div className="rounded-2xl border border-white/10 px-5 py-4 text-right"><p className={`text-4xl font-semibold ${scoreColor}`}>{score === null ? '—' : Math.round(score)}</p><p className="text-[9px] text-zinc-500">RECORDED ALPHA SCORE</p></div></div>
      {!row ? <p className="mt-5 text-sm text-amber-200">{ambiguous ? 'Select the chain for this address. The same address may identify different tokens across chains.' : result.error ? 'Research lookup unavailable. No market conclusion was made.' : 'No recorded market snapshot. Use Telegram for a fresh scan.'}</p> : <>
        <div className="mt-5 rounded-xl border border-white/10 p-3 text-xs leading-6 text-zinc-400"><p>Observed {timestamp(market?.observedAt ?? null)} · {market?.stale ? 'STALE — not a current quote' : 'Recorded snapshot — not a live quote'}</p><p>{market?.source}</p></div>
        {market?.venuePending && <p className="mt-4 text-sm text-amber-200">Market figures withheld: identity, observation time or active venue is not confirmed. Launch records alone do not establish current bonding status.</p>}
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{facts.map(([label,value])=><div key={label} className="rounded-2xl border border-white/[0.07] bg-[#1c2125] p-3.5"><p className="text-[8px] tracking-[0.13em] text-zinc-500">{label}</p><p className="mt-1.5 text-sm font-semibold">{value}</p></div>)}</div>
        <p className="mt-3 text-xs text-zinc-500">Observed peak covers AlphaOS records, not lifetime ATH. A dash means unavailable, not zero.</p>
      </>}
      {ambiguous && <div className="mt-4 flex flex-wrap gap-3">{Array.from(new Set(candidates.map(r=>r.chain))).map(c=><Link key={c} href={`/intelligence/${encodeURIComponent(decoded)}?chain=${encodeURIComponent(c ?? 'unknown')}`} className="text-sm text-emerald-300">{c}</Link>)}</div>}
    </section>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="rounded-3xl border border-white/10 bg-[#171b1f] p-5"><p className="text-[10px] tracking-widest text-zinc-500">RECORDED MARKET RISK</p><h2 className={`mt-2 text-xl font-semibold ${risk === 'HIGH' ? 'text-rose-300' : risk === 'MEDIUM' ? 'text-amber-300' : 'text-zinc-300'}`}>{risk}</h2><p className="mt-3 text-sm text-zinc-400">Market heuristic from the stored research record. Sellability, contract safety and linked wallets are not established by this score.</p><p className="mt-3 text-xs text-zinc-500">Scanner: {row?.source_agent ?? 'Unknown'}</p>{alertPrice !== null && <p className="mt-4 text-sm text-zinc-300">Historical alert price {price(alertPrice)} · {timestamp(alertedAt)}</p>}</section>
      <aside className="rounded-3xl border border-white/10 bg-[#171b1f] p-5"><h2 className="text-xl font-semibold">Verify before acting.</h2><p className="mt-3 text-sm text-zinc-400">Check the token and active trading venue before using these recorded figures.</p>{venueUrl && <a href={venueUrl} target="_blank" rel="noreferrer" className="mt-5 flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/25 px-4 text-xs text-emerald-200">{market?.venuePending ? 'Open PONS venue ↗' : 'Open recorded DEX pair ↗'}</a>}<Link href="/scan" className="mt-2 flex min-h-11 items-center justify-center rounded-xl border border-white/10 text-xs">Request a fresh Telegram scan →</Link></aside>
    </div></div></main></AppShell>;
}
