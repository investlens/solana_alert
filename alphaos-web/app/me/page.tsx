import AppShell from "@/components/layout/AppShell";

const sections = [
  ["Alert Preferences", "Choose which AlphaOS opportunities reach you first.", "Alerts"],
  ["Watchlist", "Your tracked tokens, developers and wallets.", "Tracking"],
  ["Chain Preferences", "Solana and Robinhood · PONS intelligence controls.", "Chains"],
  ["Membership", "AlphaOS Pro access and intelligence capabilities.", "Pro"],
  ["Notifications", "Telegram and future app notification preferences.", "Delivery"],
  ["Help & Account", "Account access, product help and support.", "Account"],
];

export default function MePage() {
  return <AppShell><main className="px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-10 lg:pt-9"><div className="mx-auto max-w-5xl">
    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Your AlphaOS</p>
    <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white md:text-5xl">Me</h1>
    <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">One place for your intelligence preferences, tracked assets and AlphaOS access.</p>
    <section className="mt-7 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-5"><div className="flex items-center justify-between gap-4"><div><p className="text-xs font-semibold text-white">AlphaOS account</p><p className="mt-1 text-xs text-zinc-600">Browser experience active · Telegram connection supported</p></div><span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-300">Active</span></div></section>
    <section className="mt-4 grid gap-3 md:grid-cols-2">{sections.map(([title, description, tag]) => <div key={title} className="rounded-2xl border border-white/[0.08] bg-[#0a0c0f] p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold text-white">{title}</h2><p className="mt-2 text-xs leading-5 text-zinc-600">{description}</p></div><span className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[8px] uppercase tracking-wider text-zinc-600">{tag}</span></div><p className="mt-5 text-[10px] text-zinc-700">Configuration controls activate as account identity is connected.</p></div>)}</section>
  </div></main></AppShell>;
}
