"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useState,
} from "react";

type AppShellProps = {
  children: ReactNode;
};

type NavigationItem = {
  label: string;
  href: string;
  description: string;
  icon: string;
};

const navigationItems: NavigationItem[] = [
  {
    label: "Research",
    href: "/",
    description: "Investigate any token",
    icon: "⌕",
  },
  {
    label: "Mission Control",
    href: "/dashboard",
    description: "Live AlphaOS overview",
    icon: "◎",
  },
  {
    label: "Opportunities",
    href: "/opportunities",
    description: "Tracked market setups",
    icon: "↗",
  },
];

function isActiveRoute(
  pathname: string,
  href: string
): boolean {
  if (href === "/") {
    return pathname === "/";
  }

  return (
    pathname === href ||
    pathname.startsWith(`${href}/`)
  );
}

function NavigationLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavigationItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActiveRoute(
    pathname,
    item.href
  );

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={[
        "group flex items-center gap-3 rounded-2xl border px-3 py-3 transition",
        active
          ? "border-emerald-400/20 bg-emerald-400/[0.08]"
          : "border-transparent hover:border-white/[0.07] hover:bg-white/[0.03]",
      ].join(" ")}
    >
      <div
        className={[
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-base transition",
          active
            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
            : "border-white/[0.07] bg-white/[0.025] text-zinc-500 group-hover:text-zinc-300",
        ].join(" ")}
      >
        {item.icon}
      </div>

      <div className="min-w-0">
        <p
          className={[
            "truncate text-sm font-medium",
            active
              ? "text-white"
              : "text-zinc-400 group-hover:text-white",
          ].join(" ")}
        >
          {item.label}
        </p>

        <p className="mt-0.5 truncate text-[11px] text-zinc-600">
          {item.description}
        </p>
      </div>
    </Link>
  );
}

function Brand() {
  return (
    <Link href="/" className="block">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-sm font-bold text-emerald-300">
          A
        </div>

        <div>
          <p className="text-base font-semibold tracking-tight text-white">
            AlphaOS{" "}
            <span className="text-emerald-300">
              AI
            </span>
          </p>

          <p className="mt-0.5 text-[10px] uppercase tracking-[0.13em] text-zinc-600">
            Crypto Intelligence OS
          </p>
        </div>
      </div>
    </Link>
  );
}

function SystemStatus() {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-300">
            Intelligence Core
          </p>

          <p className="mt-1 text-[11px] text-zinc-600">
            Scanner and memory online
          </p>
        </div>

        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
      </div>
    </div>
  );
}

export default function AppShell({
  children,
}: AppShellProps) {
  const pathname = usePathname();

  const [mobileOpen, setMobileOpen] =
    useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-[#050609] text-white">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[270px] border-r border-white/[0.07] bg-[#07090c] lg:flex lg:flex-col">
        <div className="border-b border-white/[0.07] px-6 py-6">
          <Brand />
        </div>

        <nav className="flex-1 space-y-2 px-4 py-5">
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-700">
            Workspace
          </p>

          {navigationItems.map((item) => (
            <NavigationLink
              key={item.href}
              item={item}
              pathname={pathname}
            />
          ))}
        </nav>

        <div className="space-y-3 border-t border-white/[0.07] p-4">
          <SystemStatus />

          <p className="px-2 text-[10px] leading-5 text-zinc-700">
            AlphaOS provides research and intelligence,
            not financial advice.
          </p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.07] bg-[#050609]/90 px-4 backdrop-blur-xl lg:hidden">
        <Brand />

        <button
          type="button"
          onClick={() =>
            setMobileOpen((current) => !current)
          }
          aria-label="Open navigation"
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg text-zinc-300"
        >
          {mobileOpen ? "×" : "☰"}
        </button>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-20 bg-black/70 backdrop-blur-sm lg:hidden">
          <div className="absolute inset-x-3 top-20 rounded-3xl border border-white/10 bg-[#0a0c0f] p-4 shadow-2xl">
            <nav className="space-y-2">
              {navigationItems.map((item) => (
                <NavigationLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  onNavigate={() =>
                    setMobileOpen(false)
                  }
                />
              ))}
            </nav>

            <div className="mt-4">
              <SystemStatus />
            </div>
          </div>
        </div>
      ) : null}

      <div className="lg:pl-[270px]">
        <div className="min-h-screen">
          {children}
        </div>
      </div>
    </div>
  );
}