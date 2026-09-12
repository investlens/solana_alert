"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AppShellProps = { children: ReactNode };
type NavigationItem = { label: string; href: string; description: string; icon: string };

const navigationItems: NavigationItem[] = [
  { label: "Home", href: "/", description: "Performance and market pulse", icon: "⌂" },
  { label: "Radar", href: "/opportunities", description: "Live market setups", icon: "⌁" },
  { label: "Intel", href: "/intelligence", description: "Developers and smart money", icon: "◇" },
  { label: "Game", href: "/game", description: "Reputation and rewards", icon: "◆" },
  { label: "Me", href: "/me", description: "Preferences and membership", icon: "○" },
];

function isActiveRoute(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-white/[0.10] to-white/[0.03] text-xs font-bold text-white shadow-[0_8px_30px_rgba(0,0,0,0.25)]">A</div>
      <div>
        <p className="text-sm font-semibold tracking-tight text-white">AlphaOS <span className="text-emerald-300">AI</span></p>
        <p className="text-[8px] uppercase tracking-[0.14em] text-zinc-500">Crypto Intelligence</p>
      </div>
    </Link>
  );
}

function SystemStatus() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1.5 shadow-sm">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      <span className="text-[9px] font-semibold tracking-wider text-zinc-300">LIVE</span>
    </div>
  );
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#101316] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.035),transparent_32%),radial-gradient(circle_at_90%_15%,rgba(52,211,153,0.025),transparent_26%)]" />

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[250px] border-r border-white/[0.07] bg-[#13171b]/95 shadow-[12px_0_50px_rgba(0,0,0,0.12)] backdrop-blur-xl lg:flex lg:flex-col">
        <div className="border-b border-white/[0.07] px-5 py-6"><Brand /></div>
        <nav className="flex-1 space-y-1.5 px-3 py-5">
          <p className="px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Workspace</p>
          {navigationItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${active ? "border-white/[0.10] bg-white/[0.07] text-white shadow-sm" : "border-transparent text-zinc-500 hover:bg-white/[0.035] hover:text-white"}`}>
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${active ? "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300" : "border-white/[0.07] bg-white/[0.025]"}`}>{item.icon}</span>
                <span><span className="block text-sm font-medium">{item.label}</span><span className="mt-0.5 block text-[10px] text-zinc-600">{item.description}</span></span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/[0.07] p-4">
          <div className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-[#181d21] p-3 shadow-sm">
            <div><p className="text-xs text-zinc-200">Intelligence Core</p><p className="mt-0.5 text-[9px] text-zinc-500">Scanner online</p></div><SystemStatus />
          </div>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-[60px] items-center justify-between border-b border-white/[0.07] bg-[#111519]/92 px-4 shadow-sm backdrop-blur-xl lg:hidden"><Brand /><SystemStatus /></header>
      <div className="relative lg:pl-[250px]">{children}</div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#14181c]/96 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(0,0,0,0.20)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
          {navigationItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`flex min-h-12 flex-col items-center justify-center rounded-xl text-[9px] font-medium transition ${active ? "bg-white/[0.07] text-white" : "text-zinc-500"}`}>
                <span className={`mb-0.5 text-base leading-none ${active ? "text-emerald-300" : ""}`}>{item.icon}</span>{item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
