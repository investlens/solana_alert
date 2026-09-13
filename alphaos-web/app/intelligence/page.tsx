import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type DeveloperRow = {
  deployer_address: string; total_launches: number | null; winners_100k: number | null;
  winners_500k: number | null; winners_1m: number | null; winners_5m: number | null;
  winners_10m: number | null; best_verified_peak_market_cap: number | null;
  hit_rate_100k: number | null; hit_rate_1m: number | null; severe_crash_rate: number | null;
  confidence: string | null; tier: string | null; risk_tier: string | null;
  latest_launch_at: string | null; best_token_address: string | null; is_blocked: boolean | null;
};

const shortAddress = (value: string) => value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
function fmtMoney(value: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(value));
}
function fmtPct(value: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value); return `${Math.round((n <= 1 ? n * 100 : n) * 10) / 10}%`;
}
function tierClass(value: string | null) {
  const v = String(value ?? "").toUpperCase();
  if (["LEGEND", "KING", "GEM", "PROVEN"].includes(v)) return "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300";
  if (v === "PROMISING") return "border-amber-400/20 bg-amber-400/[0.07] text-amber-300";
  if (v.includes("SPAM") || v.includes("SCAM") || v.includes("BLOCK")) return "border-rose-400/20 bg-rose-400/[0.06] text-rose-300";
  return "border-white/[0.08] bg-white/[0.03] text-zinc-400";
}

export default async function IntelligencePage() {
  let developers: DeveloperRow[] = [];
  let loadError: string | null = null;
  try {
    const { data, error } = await supabaseAdmin.from("pons_developer_registry")
      .select("deployer_address,total_launches,winners_100k,winners_500k,winners_1m,winners_5m,winners_10m,best_verified_peak_market_cap,hit_rate_100k,hit_rate_1m,severe_crash_rate,confidence,tier,risk_tier,latest_launch_at,best_token_address,is_blocked")
      .order("best_verified_peak_market_cap", { ascending: false, nullsFirst: false }).limit(80);
    if (error) throw error; developers = (data ?? []) as DeveloperRow[];
  } catch (error) { loadError = error instanceof Error ? error.message : "Developer intelligence is temporarily unavailable."; }

  const elite = developers.filter(d => ["LEGEND", "KING", "GEM", "PROVEN"].includes(String(d.tier ?? "").toUpperCase()) && !d.is_blocked);
  const promising = developers.filter(d => String(d.tier ?? "").toUpperCase() === "PROMISING" && !d.is_blocked);
  const risky = developers.filter(d => d.is_blocked || ["SPAM_LAUNCHER", "SCAMMER"].includes(String(d.tier ?? "").toUpperCase()));
  const visibleRows = [...elite, ...promising, ...developers.filter(d => !elite.includes(d) && !promising.includes(d) && !risky.includes(d))].slice(0, 40);
  const best = elite[0] ?? developers[0];

  return <AppShell><main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"><div className="mx-auto max-w-[1540px]">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">AlphaOS Intelligence</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Developer Radar</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Know who launched it before the crowd does. Verified PONS history, repeat winners, launch cadence and risk — without bypassing token security.</p></div>
      <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-3"><p className="text-[9px] uppercase tracking-[0.16em] text-emerald-300/60">Radar status</p><p className="mt-1 text-sm font-semibold text-emerald-300">● LIVE · PONS</p></div>
    </div>

    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <RadarCard eyebrow="HOT DEVELOPERS" value={String(elite.length)} body="Verified high-performing wallets currently on radar." accent />
      <RadarCard eyebrow="BIGGEST VERIFIED WINNER" value={fmtMoney(best?.best_verified_peak_market_cap ?? null)} body={best ? `From ${shortAddress(best.deployer_address)}` : "Outcome learning in progress."} accent />
      <RadarCard eyebrow="PROMISING WATCH" value={String(promising.length)} body="Early evidence only — not promoted to proven status." />
      <RadarCard eyebrow="RISK SHIELD" value={String(risky.length)} body="Serial spam / blocked wallets kept out of proven-dev routing." danger={risky.length > 0} />
    </div>

    <section className="mt-5 rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.055] to-[#15191d] p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-300">⚡ Developer Signal</p><h2 className="mt-2 text-xl font-semibold text-white">When a high-performing wallet launches again, AlphaOS knows the history instantly.</h2><p className="mt-2 max-w-3xl text-xs leading-5 text-zinc-500">The alert carries prior winners, hit rate, best verified peak and developer confidence. Repeatability is shown separately from a single historical winner. Reputation adds context only; launch and liquidity security remain authoritative.</p></div><span className="shrink-0 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-2 text-[10px] font-semibold text-emerald-300">FREE DURING LAUNCH PHASE</span></div>
    </section>

    <section className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#15191d]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6"><div><p className="text-sm font-semibold text-white">Verified Developer Leaderboard</p><p className="mt-1 text-[11px] text-zinc-600">Ranked by verified outcome evidence. Insufficient history is never dressed up as confidence.</p></div><span className="text-[10px] text-zinc-600">Tap a wallet → full contract history</span></div>
      {loadError ? <div className="p-6 text-sm text-amber-300">Database read unavailable. Live discovery remains independent of this screen.</div> : visibleRows.length === 0 ? <div className="p-6 text-sm text-zinc-500">Outcome learning is building the registry.</div> : <div className="divide-y divide-white/[0.055]">{visibleRows.map((dev, index) => <Link key={dev.deployer_address} href={`/intelligence/developer/${encodeURIComponent(dev.deployer_address)}`} className="grid gap-3 px-5 py-4 transition hover:bg-white/[0.025] sm:px-6 lg:grid-cols-[.25fr_1.35fr_.45fr_.55fr_.55fr_.65fr_.45fr] lg:items-center">
        <div className="text-xs font-semibold text-zinc-600">#{index + 1}</div><div><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs text-zinc-200">{shortAddress(dev.deployer_address)}</p><span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${tierClass(dev.tier)}`}>{dev.tier ?? "UNKNOWN"}</span></div><p className="mt-1 text-[10px] text-zinc-600">{dev.confidence ?? "INSUFFICIENT"} confidence · {dev.total_launches ?? 0} launches</p></div>
        <Metric label="$100K+" value={String(dev.winners_100k ?? 0)} accent={Number(dev.winners_100k ?? 0) > 0}/><Metric label="$1M+" value={String(dev.winners_1m ?? 0)} accent={Number(dev.winners_1m ?? 0) > 0}/><Metric label="Hit rate" value={fmtPct(dev.hit_rate_100k)}/><Metric label="Best peak" value={fmtMoney(dev.best_verified_peak_market_cap)}/><div className="text-left lg:text-right"><span className="text-xs text-zinc-500">Profile →</span></div>
      </Link>)}</div>}
    </section>
  </div></main></AppShell>;
}

function RadarCard({ eyebrow, value, body, accent=false, danger=false }: { eyebrow:string; value:string; body:string; accent?:boolean; danger?:boolean }) {
  return <div className={`rounded-2xl border p-4 ${danger ? "border-rose-400/15 bg-rose-400/[0.035]" : accent ? "border-emerald-400/15 bg-emerald-400/[0.035]" : "border-white/[0.07] bg-[#171b1f]"}`}><p className="text-[8px] font-semibold uppercase tracking-[0.15em] text-zinc-600">{eyebrow}</p><p className={`mt-2 text-2xl font-semibold ${danger ? "text-rose-300" : accent ? "text-emerald-300" : "text-white"}`}>{value}</p><p className="mt-1.5 text-[11px] leading-4 text-zinc-600">{body}</p></div>;
}
function Metric({ label, value, accent=false }: { label:string; value:string; accent?:boolean }) { return <div><p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">{label}</p><p className={`mt-1 text-sm font-semibold ${accent ? "text-emerald-300" : "text-zinc-200"}`}>{value}</p></div>; }
