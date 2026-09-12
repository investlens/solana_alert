import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ wallet: string }> };

function money(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
}

function short(value: string) {
  return value.length > 24 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

export default async function DeveloperProfilePage({ params }: Props) {
  const { wallet } = await params;
  const decoded = decodeURIComponent(wallet).toLowerCase();

  const [registryResult, launchesResult] = await Promise.all([
    supabaseAdmin.from("pons_developer_registry").select("*").eq("deployer_address", decoded).limit(1).maybeSingle(),
    supabaseAdmin.from("pons_launches").select("token_address,deployer_address,curve_address,pool_address,pair_token_address,block_number,block_timestamp,transaction_hash,protocol,protocol_version").eq("deployer_address", decoded).order("block_timestamp", { ascending: false }).limit(50),
  ]);

  const registry = registryResult.data as Record<string, unknown> | null;
  const launches = (launchesResult.data ?? []) as Record<string, unknown>[];
  const tier = String(registry?.tier ?? "UNKNOWN");
  const confidence = String(registry?.confidence ?? "INSUFFICIENT");
  const risk = String(registry?.risk_tier ?? "UNKNOWN");

  return (
    <AppShell>
      <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex items-center justify-between gap-4">
            <Link href="/intelligence" className="text-xs text-zinc-500">← Developer Intelligence</Link>
            <span className="rounded-full border border-white/[0.08] px-3 py-1 text-[9px] text-zinc-400">PONS · ROBINCHAIN</span>
          </div>

          <section className="mt-5 rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-7">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Developer Wallet Profile</p>
            <h1 className="mt-3 break-all font-mono text-lg font-semibold text-white sm:text-2xl">{decoded}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {[tier, confidence, `RISK ${risk}`].map((value) => <span key={value} className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-1 text-[9px] font-semibold text-zinc-300">{value}</span>)}
            </div>

            <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Launches" value={String(registry?.total_launches ?? launches.length)} />
              <Stat label="$100k wins" value={String(registry?.winners_100k ?? 0)} />
              <Stat label="$500k wins" value={String(registry?.winners_500k ?? 0)} />
              <Stat label="$1m wins" value={String(registry?.winners_1m ?? 0)} />
              <Stat label="$5m wins" value={String(registry?.winners_5m ?? 0)} />
              <Stat label="Best verified peak" value={money(registry?.best_verified_peak_market_cap)} />
            </div>
          </section>

          <section className="mt-4 overflow-hidden rounded-3xl border border-white/[0.08] bg-[#15191d]">
            <div className="border-b border-white/[0.07] px-5 py-4 sm:px-6">
              <p className="text-sm font-semibold text-white">Indexed Project History</p>
              <p className="mt-1 text-[11px] text-zinc-600">Contracts AlphaOS has linked to this deployer. Market outcomes appear only when verified.</p>
            </div>
            {launchesResult.error ? (
              <div className="p-6 text-sm text-amber-300">Project history is temporarily unavailable while the database recovers.</div>
            ) : launches.length === 0 ? (
              <div className="p-6 text-sm text-zinc-500">No indexed launches found for this wallet yet.</div>
            ) : (
              <div className="divide-y divide-white/[0.055]">
                {launches.map((launch) => {
                  const token = String(launch.token_address ?? "");
                  return (
                    <div key={`${token}-${String(launch.transaction_hash ?? "")}`} className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[1.4fr_.7fr_.7fr_.5fr] lg:items-center">
                      <div>
                        <p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">Contract</p>
                        <p className="mt-1 font-mono text-xs text-zinc-200">{short(token)}</p>
                      </div>
                      <div><p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">Launched</p><p className="mt-1 text-xs text-zinc-300">{launch.block_timestamp ? new Date(String(launch.block_timestamp)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}</p></div>
                      <div><p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">Protocol</p><p className="mt-1 text-xs text-zinc-300">{String(launch.protocol ?? "PONS")} {String(launch.protocol_version ?? "")}</p></div>
                      <Link href={`/intelligence/${encodeURIComponent(token)}?chain=robinhood`} className="flex min-h-9 items-center justify-center rounded-xl border border-white/[0.08] px-3 text-[10px] text-zinc-300 transition hover:bg-white/[0.04]">Open token →</Link>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-white/[0.07] bg-[#1c2125] p-3.5"><p className="text-[8px] uppercase tracking-[0.13em] text-zinc-600">{label}</p><p className="mt-1.5 text-sm font-semibold text-white">{value}</p></div>;
}
