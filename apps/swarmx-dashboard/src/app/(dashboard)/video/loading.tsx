/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/loading.tsx
 */

export default function VideoLoading() {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header skeleton */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="space-y-1.5">
          <div className="h-4 w-36 bg-zinc-800 rounded animate-pulse" />
          <div className="h-3 w-56 bg-zinc-800/60 rounded animate-pulse" />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Left column skeleton */}
        <div className="w-full max-w-xl border-r border-zinc-800 p-5 space-y-4">
          {/* Form skeleton */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 space-y-4">
            <div className="h-4 w-28 bg-zinc-800 rounded animate-pulse" />
            <div className="h-20 w-full bg-zinc-800/50 rounded-lg animate-pulse" />
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 bg-zinc-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
            <div className="flex justify-end">
              <div className="h-9 w-32 bg-amber-900/30 rounded-lg animate-pulse" />
            </div>
          </div>

          {/* Job cards skeleton */}
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3"
              style={{ opacity: 1 - i * 0.2 }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-12 bg-zinc-800 rounded animate-pulse" />
                  <div className="h-3 w-16 bg-zinc-800/60 rounded animate-pulse" />
                </div>
              </div>
              <div className="h-3 w-full bg-zinc-800/50 rounded animate-pulse" />
              <div className="h-3 w-4/5 bg-zinc-800/40 rounded animate-pulse" />
              <div className="h-1 w-full bg-zinc-800 rounded-full animate-pulse" />
            </div>
          ))}
        </div>

        {/* Detail panel skeleton */}
        <div className="flex-1 p-5 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700 mx-auto animate-pulse" />
            <div className="h-3 w-32 bg-zinc-800/50 rounded mx-auto animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}