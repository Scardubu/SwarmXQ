"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useEventsStore } from "@/stores/events";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  LayoutDashboard,
  Bot,
  GitBranch,
  PenLine,
  ScrollText,
  Server,
  Settings,
  ChevronRight,
} from "lucide-react";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  shortcut: string;
  badgeCount?: number;
}

function useNavItems(): NavItem[] {
  const errorAgentCount = useEventsStore((s) => s.errorAgentCount);
  return [
    { id: "overview",   label: "Overview",     href: "/",          icon: LayoutDashboard, shortcut: "⌘1" },
    { id: "composer",   label: "Composer",     href: "/composer",  icon: PenLine,         shortcut: "⌘2" },
    { id: "agents",     label: "Agent Fleet",  href: "/agents",    icon: Bot,             shortcut: "⌘3", badgeCount: errorAgentCount },
    { id: "workflows",  label: "Workflows",    href: "/workflows", icon: GitBranch,       shortcut: "⌘4" },
    { id: "logs",       label: "Logs",         href: "/logs",      icon: ScrollText,      shortcut: "⌘5" },
    { id: "system",     label: "System",       href: "/system",    icon: Server,          shortcut: "⌘6" },
  ];
}

export function NavRail() {
  const pathname = usePathname();
  const navExpanded = useUIStore((s) => s.navExpanded);
  const setNavExpanded = useUIStore((s) => s.setNavExpanded);
  const navItems = useNavItems();

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        className={cn(
          "row-start-2 col-start-1 flex flex-col",
          "bg-bg-base border-r border-border",
          "overflow-hidden transition-[width] duration-(--duration-panel) ease-snap",
          "z-30 rail-enter",
          navExpanded ? "w-(--nav-rail-expanded)" : "w-(--nav-rail-width)"
        )}
        onMouseEnter={() => !navExpanded && setNavExpanded(true)}
        onMouseLeave={() => navExpanded && setNavExpanded(false)}
        aria-label="Primary navigation"
      >
        {/* Nav items */}
        <div className="flex flex-col gap-0.5 px-2 pt-2 flex-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            const Icon = item.icon;
            const isComposer = item.id === "composer";

            const itemContent = (
              <Link
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-3 rounded px-2 py-2",
                  "text-xs font-ui transition-colors duration-(--duration-micro)",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                  isActive
                    ? "text-accent bg-(--color-accent-dim) border-l-2 border-accent -ml-px pl-[7px] nav-item-active-glow"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-surface border-l-2 border-transparent -ml-px pl-[7px]"
                  ,
                  isComposer && !isActive && "text-accent/90"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isActive ? "text-accent" : "text-text-secondary group-hover:text-text-primary"
                  )}
                  aria-hidden="true"
                />

                {/* Label — visible when expanded */}
                <span
                  className={cn(
                    "flex-1 truncate whitespace-nowrap transition-[opacity,width] duration-(--duration-panel)",
                    navExpanded ? "opacity-100" : "opacity-0 w-0 overflow-hidden"
                  )}
                >
                  {item.label}
                </span>

                {/* Keyboard shortcut — visible when expanded, no badge */}
                {navExpanded && !item.badgeCount && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isComposer && (
                      <span className="text-[8px] font-mono px-1 rounded border border-accent/30 text-accent/80">
                        AI
                      </span>
                    )}
                    <span className="text-[9px] font-mono text-text-muted/50 shrink-0">
                      {item.shortcut}
                    </span>
                  </div>
                )}

                {/* Error badge */}
                {item.badgeCount != null && item.badgeCount > 0 && (
                  <span
                    className={cn(
                      "flex items-center justify-center rounded-full text-[9px] font-mono font-semibold",
                      "bg-status-error text-white min-w-3.5 h-3.5 px-1",
                      navExpanded ? "opacity-100" : "absolute top-1 right-1 opacity-100"
                    )}
                    aria-label={`${item.badgeCount} errors`}
                  >
                    {item.badgeCount > 99 ? "99+" : item.badgeCount}
                  </span>
                )}
              </Link>
            );

            // Show tooltip only when nav is collapsed
            if (!navExpanded) {
              return (
                <Tooltip key={item.id}>
                  <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
                  <TooltipContent side="right" className="flex items-center gap-2">
                    <span>{item.label}</span>
                    <kbd className="text-text-muted text-[9px] bg-bg-elevated px-1 py-0.5 rounded border border-border font-mono">
                      {item.shortcut}
                    </kbd>
                  </TooltipContent>
                </Tooltip>
              );
            }

            return <React.Fragment key={item.id}>{itemContent}</React.Fragment>;
          })}
        </div>

        <Separator />

        {/* Settings */}
        <div className="px-2 py-2">
          {navExpanded ? (
            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-3 rounded px-2 py-2",
                "text-xs font-ui text-text-secondary hover:text-text-primary hover:bg-bg-surface",
                "transition-colors duration-(--duration-micro)",
                pathname === "/settings" && "text-accent bg-(--color-accent-dim)"
              )}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>Settings</span>
              <ChevronRight className="ml-auto h-3 w-3 text-text-muted" />
            </Link>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href="/settings"
                  className={cn(
                    "flex items-center justify-center rounded p-2",
                    "text-text-secondary hover:text-text-primary hover:bg-bg-surface",
                    "transition-colors duration-(--duration-micro)",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
                  )}
                >
                  <Settings className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">Settings</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Version — only shown when expanded */}
        {navExpanded && (
          <div className="px-4 pb-3 pt-0">
            <span className="text-[8px] font-mono text-text-muted/40 tracking-widest uppercase select-none">
              SwarmX v6
            </span>
          </div>
        )}
      </nav>
    </TooltipProvider>
  );
}
