/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/loading.tsx
 *
 * Suspense skeleton for the individual video job detail route.
 * Shown while the page.tsx component is loading on first navigation.
 */

export default function VideoJobDetailLoading() {
  return (
    <div className="flex flex-col h-full min-h-0 animate-pulse">
      {/* Header skeleton */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-4 w-4 bg-zinc-800 rounded" />
          <div className="h-4 w-28 bg-zinc-800 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-16 bg-zinc-800 rounded-full" />
          <div className="h-6 w-20 bg-zinc-800 rounded" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-3xl">
        {/* Prompt */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
          <div className="h-3 w-20 bg-zinc-800 rounded" />
          <div className="h-4 w-4/5 bg-zinc-800 rounded" />
          <div className="h-4 w-3/5 bg-zinc-800 rounded" />
        </div>

        {/* Progress */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-3 w-24 bg-zinc-800 rounded" />
            <div className="h-3 w-10 bg-zinc-800 rounded" />
          </div>
          <div className="h-1 w-full bg-zinc-800 rounded-full" />
          <div className="space-y-2.5 ml-2 border-l border-zinc-800 pl-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-3 h-3 rounded-full bg-zinc-800" />
                <div className="h-3 bg-zinc-800 rounded" style={{ width: `${55 + i * 8}px` }} />
              </div>
            ))}
          </div>
        </div>

        {/* Metadata */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-2">
          <div className="h-3 w-16 bg-zinc-800 rounded" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-3 bg-zinc-800 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
