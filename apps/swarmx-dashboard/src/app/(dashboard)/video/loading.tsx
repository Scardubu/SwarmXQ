/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/loading.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Suspense loading boundary for the video page.
 * Renders immediately — keeps the rest of the dashboard interactive
 * while the video route's async data loads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Film } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export default function VideoPageLoading() {
  return (
    <div className="flex flex-col gap-6 p-6 max-w-5xl mx-auto">
      {/* Header skeleton */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Film className="h-6 w-6 text-text-muted opacity-40" aria-hidden />
          <div className="space-y-1.5">
            <div className="h-4 w-36 rounded-md bg-bg-surface animate-pulse" />
            <div className="h-2.5 w-48 rounded-md bg-bg-surface animate-pulse" />
          </div>
        </div>
        <div className="h-7 w-24 rounded-md bg-bg-surface animate-pulse" />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        {/* Form skeleton */}
        <div className="rounded-xl border border-border-subtle bg-bg-elevated p-5 space-y-4">
          <div className="h-4 w-28 rounded bg-bg-surface animate-pulse" />
          <div className="h-9 w-full rounded-md bg-bg-surface animate-pulse" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-8 rounded-md bg-bg-surface animate-pulse" />
            <div className="h-8 rounded-md bg-bg-surface animate-pulse" />
          </div>
          <div className="h-8 w-full rounded-md bg-bg-surface animate-pulse" />
        </div>

        {/* Job list skeleton */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-bg-surface animate-pulse" />
            <div className="h-3 w-16 rounded bg-bg-surface animate-pulse" />
            <Separator className="flex-1" />
          </div>
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-border-subtle bg-bg-elevated p-4 space-y-3"
              aria-hidden
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded-full bg-bg-surface animate-pulse" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-64 rounded bg-bg-surface animate-pulse" />
                  <div className="h-2.5 w-32 rounded bg-bg-surface animate-pulse" />
                </div>
              </div>
              <div className="h-1 w-full rounded-full bg-bg-surface animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">Loading video generation page…</p>
    </div>
  );
}
