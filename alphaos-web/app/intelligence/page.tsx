import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type DeveloperRow = {
  deployer_address: string;
  total_launches: number | null;
  winners_100k: number | null;
  winners_500k: number | null;
  winners_1m: number | null;
  best_verified_peak_market_cap: number | null;
  hit_rate_100k: number | null;
  hit_rate_1m: number | null;
  confidence: string | null;
  tier: string | null;
  risk_tier: string | null;
  latest_launch_at: string | null;
  best_token_address: string | null;
};

function shortAddress(value: string) {
  return value.length > 20 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function fmtMoney(value: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value));
}

function fmtPct(value: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  return `${n <= 1 ? n * 100 : n}`.replace(/\.0+$/, "") + "%";
}

function statusClass(value: string | null) {
  const v = String(value ?? "").toUpperCase();
  if (v.includes("HIGH") || v.includes("BLOCK")) return "border-rose-400/20 bg-rose-400/[0.06] text-rose-300";
  if (v.includes("ELITE") || v.includes("PROVEN") || v.includes("HIGH_CONFIDENCE")) return "border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-300";
  if (v.includes("PROMISING") || v.includes("MEDIUM")) return "border-amber-400/20 bg-amber-400/[0.07] text-amber-300";
  return "border-white/[0.08] bg-white/[0.03] text-zinc-400";
}

export default async function IntelligencePage() {
  let developers: DeveloperRow[] = [];
  let loadError: string | null = null;

  try {
    const { data, error } = await supabaseAdmin
      .from("pons_developer_registry")
      .select("deployer_address,total_launches,winners_100k,winners_500k,winners_1m,best_verified_peak_market_cap,hit_rate_100k,hit_rate_1m,confidence,tier,risk_tier,latest_launch_at,best_token_address")
      .order("latest_launch_at", { ascending: false, nullsFirst: false })
      .limit(40);

    if (error) throw error;
    developers = (data ?? []) as DeveloperRow[];
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Developer intelligence is temporarily unavailable.";
  }

  const qualified = developers.filter((row) =>
    Number(row.winners_100k ?? 0) > 0 ||
    Number(row.winners_1m ?? 0) > 0 ||
    Number(row.best_verified_peak_market_cap ?? 0) > 0 ||
    !["", "INSUFFICIENT", "UNKNOWN"].includes(String(row.confidence ?? "").toUpperCase())
  );
  const visibleRows = qualified.length >= 8 ? qualified : developers;

  return (
    <AppShell>
      <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-[1540px]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300/80">AlphaOS Intelligence</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Developer Intelligence</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Track PONS developer wallets, verify their launch history, and spot new launches from wallets with proven outcomes.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-3">
              <p className="text-[9px] uppercase tracking-[0.16em] text-zinc-600">Indexed registry</p>
              <p className="mt-1 text-lg font-semibold text-white">1,275 wallets</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Developer leaderboard", "Rank wallets by verified history and confidence."],
              ["New launches", "Watch known developers for their next token deployment."],
              ["Project history", "Open any wallet to inspect every indexed contract."],
              ["Risk first", "Developer reputation supports the score; it never forces a BUY."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-white/[0.07] bg-[#171b1f] p-4">
                <p className="text-sm font-medium text-zinc-100">{title}</p>
                <p className="mt-1.5 text-xs leading-5 text-zinc-600">{body}</p>
              </div>
            ))}
          </div>

          <section className="mt-5 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#15191d]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-4 sm:px-6">
              <div>
                <p className="text-sm font-semibold text-white">Developer Registry</p>
                <p className="mt-1 text-[11px] text-zinc-600">Confidence is shown exactly as stored. Insufficient history is not promoted.</p>
              </div>
              <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1 text-[9px] font-semibold text-emerald-300">FREE DURING LAUNCH PHASE</span>
            </div>

            {loadError ? (
              <div className="p-6 text-sm text-amber-300">Database is recovering. Developer discovery remains active, but this view could not complete its read yet.</div>
            ) : visibleRows.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500">No developer registry rows are available yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.055]">
                {visibleRows.map((dev) => (
                  <Link
                    key={dev.deployer_address}
                    href={`/intelligence/developer/${encodeURIComponent(dev.deployer_address)}`}
                    className="grid gap-3 px-5 py-4 transition hover:bg-white/[0.025] sm:px-6 lg:grid-cols-[1.3fr_.55fr_.55fr_.65fr_.65fr_.45fr] lg:items-center"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono text-xs text-zinc-200">{shortAddress(dev.deployer_address)}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold ${statusClass(dev.tier ?? dev.confidence)}`}>{dev.tier ?? dev.confidence ?? "UNKNOWN"}</span>
                      </div>
                      <p className="mt-1 text-[10px] text-zinc-600">Latest launch {dev.latest_launch_at ? new Date(dev.latest_launch_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
                    </div>
                    <Metric label="Launches" value={String(dev.total_launches ?? 0)} />
                    <Metric label="$100k wins" value={String(dev.winners_100k ?? 0)} accent={Number(dev.winners_100k ?? 0) > 0} />
                    <Metric label="$1m wins" value={String(dev.winners_1m ?? 0)} accent={Number(dev.winners_1m ?? 0) > 0} />
                    <Metric label="Best peak" value={fmtMoney(dev.best_verified_peak_market_cap)} />
                    <div className="text-left lg:text-right"><span className="text-xs text-zinc-500">Open →</span></div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${accent ? "text-emerald-300" : "text-zinc-200"}`}>{value}</p>
    </div>
  );
}
