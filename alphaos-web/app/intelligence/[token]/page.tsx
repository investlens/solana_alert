import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function num(value: string | undefined) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function money(value: number | null) { return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value); }
function short(value: string) { return value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value; }

export default async function IntelligencePage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const decoded = decodeURIComponent(token);

  const { data } = await supabaseAdmin
    .from("opportunities")
    .select("id, opportunity_type, asset_id, chain, source_agent, title, entry_price, exit_price, expected_profit_percent, risk_score, confidence, status, raw_data, created_at, updated_at")
    .or(`asset_id.eq.${decoded},raw_data->>token.eq.${decoded},raw_data->>address.eq.${decoded},raw_data->>token_address.eq.${decoded}`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const raw = data?.raw_data && typeof data.raw_data === "object" && !Array.isArray(data.raw_data) ? data.raw_data as Record<string, unknown> : {};
  const symbol = String(raw.symbol ?? one(query.symbol) ?? data?.title ?? "TOKEN");
  const chain = String(data?.chain ?? one(query.chain) ?? "robinhood").toLowerCase();
  const confidence = Number(data?.confidence ?? one(query.confidence) ?? raw.score ?? 0);
  const risk = String(raw.risk_level ?? one(query.risk) ?? (Number(data?.risk_score ?? 0) > 70 ? "HIGH" : Number(data?.risk_score ?? 0) > 35 ? "MEDIUM" : "LOW"));
  const marketCap = Number(raw.market_cap ?? raw.marketCap ?? one(query.marketCap) ?? NaN);
  const liquidity = Number(raw.liquidity ?? raw.liquidity_usd ?? one(query.liquidity) ?? NaN);
  const buys = Number(raw.buys5m ?? raw.buys_5m ?? NaN);
  const sells = Number(raw.sells5m ?? raw.sells_5m ?? NaN);
  const volume = Number(raw.volume5m ?? raw.volume_5m ?? NaN);
  const source = String(data?.source_agent ?? one(query.source) ?? "AlphaOS Intelligence");
  const status = String(data?.status ?? "WATCHING").toUpperCase();
  const isRobinhood = chain === "robinhood";

  const facts = [
    ["Market cap", money(Number.isFinite(marketCap) ? marketCap : null)],
    ["Liquidity", money(Number.isFinite(liquidity) ? liquidity : null)],
    ["5m volume", money(Number.isFinite(volume) ? volume : null)],
    ["5m buys / sells", Number.isFinite(buys) || Number.isFinite(sells) ? `${Number.isFinite(buys) ? buys : "—"} / ${Number.isFinite(sells) ? sells : "—"}` : "—"],
  ];

  return <main className="min-h-screen bg-[#101316] px-4 pb-28 pt-5 text-white sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
    <div className="mx-auto max-w-[1050px]">
      <Link href="/" className="text-xs font-medium text-zinc-500 transition hover:text-white">← Back to AlphaOS</Link>

      <section className="mt-5 overflow-hidden rounded-3xl border border-white/[0.09] bg-[#171b1f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] ${isRobinhood ? "border-emerald-400/20 text-emerald-300" : "border-violet-400/20 text-violet-300"}`}>{isRobinhood ? "ROBINHOOD · PONS" : chain.toUpperCase()}</span><span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold tracking-wider text-zinc-400">{status}</span></div>
            <p className="mt-5 text-[10px] font-semibold tracking-[0.18em] text-zinc-500">ALPHAOS INTELLIGENCE</p>
            <h1 className="mt-1 text-4xl font-semibold tracking-[-0.04em]">{symbol}</h1>
            <p className="mt-2 font-mono text-[10px] text-zinc-600">{short(decoded)}</p>
          </div>
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-4 text-right"><p className="text-4xl font-semibold text-emerald-300">{Math.round(confidence)}</p><p className="mt-1 text-[9px] tracking-[0.16em] text-zinc-500">ALPHA SCORE</p></div>
        </div>

        <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">{facts.map(([label, value]) => <div key={label} className="rounded-2xl border border-white/[0.07] bg-[#1c2125] p-3.5"><p className="text-[8px] uppercase tracking-[0.13em] text-zinc-500">{label}</p><p className="mt-1.5 text-sm font-semibold text-zinc-100">{value}</p></div>)}</div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <section className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">WHY ALPHAOS IS WATCHING</p>
          <h2 className="mt-2 text-xl font-semibold">Signal context</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{data?.title ?? `${symbol} is currently being tracked by the AlphaOS ${source} engine.`}</p>
          <div className="mt-5 space-y-3 text-sm">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Source engine</span><span className="text-zinc-200">{source}</span></div>
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Risk assessment</span><span className={risk.toUpperCase() === "HIGH" ? "text-rose-300" : risk.toUpperCase() === "MEDIUM" ? "text-amber-300" : "text-emerald-300"}>{risk.toUpperCase()}</span></div>
            <div className="flex items-center justify-between"><span className="text-zinc-500">Opportunity type</span><span className="text-right text-zinc-200">{String(data?.opportunity_type ?? "TOKEN INTELLIGENCE").replaceAll("_", " ")}</span></div>
          </div>
        </section>

        <aside className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">DECISION PANEL</p>
          <h2 className="mt-2 text-xl font-semibold">Know before you act.</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-500">AlphaOS separates observed evidence from execution. A high score is intelligence, not a guarantee of return.</p>
          <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.04] p-4"><p className="text-xs font-semibold text-amber-200">Risk · {risk.toUpperCase()}</p><p className="mt-1 text-[11px] leading-5 text-zinc-500">Check liquidity, sellability and momentum before any trade.</p></div>
          <Link href="/opportunities" className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-white px-4 text-xs font-semibold text-[#111519]">Back to Live Radar</Link>
        </aside>
      </div>
    </div>
  </main>;
}
