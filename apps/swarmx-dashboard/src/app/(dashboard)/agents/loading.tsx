export default function AgentsLoading() {
  const rowCount = 8;
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar skeleton */}
      <header className="border-b border-border bg-bg-surface/80 px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton h-4 w-28" />
            <div className="skeleton h-3 w-48" />
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="skeleton h-7 w-64 rounded" />
            <div className="skeleton h-7 w-24 rounded" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {[60, 56, 52, 52, 52].map((w, i) => (
            <div key={i} className="skeleton h-7 rounded" style={{ width: `${w}px` }} />
          ))}
        </div>
      </header>

      {/* Table header */}
      <div className="border-b border-border/70 bg-bg-elevated/40 px-4 py-2">
        <div className="skeleton h-3 w-48" />
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-hidden">
        {Array.from({ length: rowCount }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border/50 px-4 py-2.5"
            style={{ opacity: 1 - i * 0.09 }}
          >
            <div className="skeleton h-2 w-2 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1 min-w-0">
              <div className="skeleton h-3 w-32" />
              <div className="skeleton h-2.5 w-24" />
            </div>
            <div className="skeleton h-5 w-14 rounded-full shrink-0" />
            <div className="skeleton h-3 w-10 shrink-0" />
            <div className="skeleton h-3 w-12 shrink-0" />
            <div className="skeleton h-3 w-28 shrink-0" />
            <div className="skeleton h-3 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
