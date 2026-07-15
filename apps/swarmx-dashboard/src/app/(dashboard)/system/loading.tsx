export default function SystemLoading() {
  return (
    <div className="flex h-full flex-col gap-0 overflow-auto" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading system metrics</span>
      {/* Tab bar skeleton */}
      <div className="border-b border-border bg-bg-surface/80 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          {[72, 64, 80, 80].map((w, i) => (
            <div key={i} className="skeleton h-7 rounded" style={{ width: `${w}px` }} />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
        {/* Metric cards row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded border border-border bg-bg-elevated/60 p-3 space-y-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-5 w-20" />
            </div>
          ))}
        </div>

        {/* Topology table */}
        <div className="rounded border border-border">
          <div className="border-b border-border px-4 py-2">
            <div className="skeleton h-4 w-36" />
          </div>
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
              style={{ opacity: 1 - i * 0.1 }}
            >
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-3 w-48" />
              <div className="skeleton h-3 w-20" />
              <div className="skeleton h-3 w-12 ml-auto" />
            </div>
          ))}
        </div>

        {/* systemd units */}
        <div className="rounded border border-border">
          <div className="border-b border-border px-4 py-2">
            <div className="skeleton h-4 w-40" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
              style={{ opacity: 1 - i * 0.12 }}
            >
              <div className="skeleton h-3 w-36" />
              <div className="skeleton h-3 w-16 ml-auto" />
              <div className="skeleton h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
