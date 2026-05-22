/**
 * apps/swarmx-dashboard/src/components/layout/NavRail.tsx
 * FIX: Added video nav item (surgical addition — existing items preserved).
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ─── Nav Items ────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: "/missions",
    label: "Missions",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    href: "/agents",
    label: "Agents",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: "/evolution",
    label: "Evolution",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    ),
  },
  {
    href: "/memory",
    label: "Memory",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
      </svg>
    ),
  },
  // ── VIDEO NAV ITEM (NEW) ──────────────────────────────────────────────────
  {
    href: "/video",
    label: "Video",
    badge: "NEW",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.362a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
  // ── END VIDEO ─────────────────────────────────────────────────────────────
  {
    href: "/logs",
    label: "Logs",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

// ─── NavItem component ────────────────────────────────────────────────────────

function NavRailItem({ item, isActive }: { item: NavItem; isActive: boolean }) {
  return (
    <Link
      href={item.href}
      className={`
        group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium
        transition-all duration-150
        ${isActive
          ? "bg-amber-600/15 text-amber-400 border border-amber-700/30"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 border border-transparent"
        }
      `}
      aria-current={isActive ? "page" : undefined}
    >
      <span className={`shrink-0 ${isActive ? "text-amber-400" : "text-zinc-600 group-hover:text-zinc-400"} transition-colors`}>
        {item.icon}
      </span>
      <span className="truncate">{item.label}</span>
      {item.badge && (
        <span className="ml-auto shrink-0 rounded-sm bg-amber-700/30 border border-amber-700/40 px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest text-amber-500">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

// ─── NavRail ──────────────────────────────────────────────────────────────────

export function NavRail() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <nav
      className="flex flex-col gap-0.5 py-2 px-3 h-full"
      aria-label="Main navigation"
    >
      {/* Logo / brand */}
      <div className="px-3 py-3 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-amber-600/20 border border-amber-700/40 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-black text-amber-500">SX</span>
          </div>
          <span className="text-sm font-semibold text-zinc-200 tracking-tight">SwarmXQ</span>
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => (
          <NavRailItem key={item.href} item={item} isActive={isActive(item.href)} />
        ))}
      </div>

      {/* Bottom: version tag */}
      <div className="px-3 py-2 mt-2">
        <p className="text-[10px] font-mono text-zinc-700">v5.9 · vΩ.APEX</p>
      </div>
    </nav>
  );
}