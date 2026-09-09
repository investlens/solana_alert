"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AppShellProps = { children: ReactNode };
type NavigationItem = { label: string; href: string; description: string; icon: string };

const navigationItems: NavigationItem[] = [
  { label: "Home", href: "/", description: "Proof and market snapshot", icon: "⌂" },
  { label: "Radar", href: "/opportunities", description: "Live market setups", icon: "⌁" },
  { label: "Intel", href: "/dashboard", description: "Research and intelligence", icon: "◇" },
  { label: "Game", href: "/game", description: "Play and future rewards", icon: "◆" },
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return <Link href="/" className="flex items-center gap-2.5">
    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300">A</div>
    <div><p className="text-sm font-semibold tracking-tight text-white">AlphaOS <span className="text-emerald-300">AI</span></p><p className="text-[8px] uppercase tracking-[0.14em] text-zinc-600">Crypto Intelligence</p></div>
  </Link>;
}

function SystemStatus() {
  return <div className="flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.05] px-2.5 py-1.5"><span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" /></span><span className="text-[9px] font-semibold tracking-wider text-emerald-300">LIVE</span></div>;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  return <div className="min-h-screen bg-[#050609] text-white">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[250px] border-r border-white/[0.07] bg-[#07090c] lg:flex lg:flex-col">
      <div className="border-b border-white/[0.07] px-5 py-6"><Brand /></div>
      <nav className="flex-1 space-y-1.5 px-3 py-5"><p className="px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-700">Workspace</p>{navigationItems.map((item) => { const active = isActiveRoute(pathname, item.href); return <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${active ? "border-emerald-400/20 bg-emerald-400/[0.08] text-white" : "border-transparent text-zinc-500 hover:bg-white/[0.03] hover:text-white"}`}><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.025]">{item.icon}</span><span><span className="block text-sm font-medium">{item.label}</span><span className="mt-0.5 block text-[10px] text-zinc-700">{item.description}</span></span></Link>; })}</nav>
      <div className="border-t border-white/[0.07] p-4"><div className="flex items-center justify-between rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3"><div><p className="text-xs text-zinc-300">Intelligence Core</p><p className="mt-0.5 text-[9px] text-zinc-600">Scanner online</p></div><SystemStatus /></div></div>
    </aside>

    <header className="sticky top-0 z-30 flex h-15 items-center justify-between border-b border-white/[0.07] bg-[#050609]/90 px-4 backdrop-blur-xl lg:hidden"><Brand /><SystemStatus /></header>

    <div className="lg:pl-[250px]">{children}</div>

    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#07090c]/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {navigationItems.map((item) => { const active = isActiveRoute(pathname, item.href); return <Link key={item.href} href={item.href} className={`flex min-h-12 flex-col items-center justify-center rounded-xl text-[9px] font-medium transition ${active ? "bg-emerald-400/[0.08] text-emerald-300" : "text-zinc-600"}`}><span className="mb-0.5 text-base leading-none">{item.icon}</span>{item.label}</Link>; })}
        <div className="flex min-h-12 flex-col items-center justify-center rounded-xl text-[9px] font-medium text-zinc-700"><span className="mb-0.5 text-base leading-none">○</span>Me</div>
      </div>
    </nav>
  </div>;
}
