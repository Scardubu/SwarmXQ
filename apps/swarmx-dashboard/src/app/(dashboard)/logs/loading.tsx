export default function LogsLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="skeleton h-4 w-36" />
          <div className="skeleton h-4 w-24" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {[36, 36, 36, 36, 36].map((w, i) => (
              <div key={i} className="skeleton h-7 rounded" style={{ width: `${w}px` }} />
            ))}
          </div>
          <div className="skeleton h-7 flex-1 rounded" />
          <div className="skeleton h-7 w-20 rounded" />
        </div>
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-hidden px-2 py-1">
        {Array.from({ length: 18 }).map((_, i) => (
          <div
            key={i}
            className="flex items-start gap-2 px-2 py-0.5"
            style={{ opacity: 0.9 - i * 0.04 }}
          >
            <div className="skeleton h-2.5 w-28 shrink-0 rounded" />
            <div className="skeleton h-2.5 w-7 shrink-0 rounded" />
            <div className="skeleton h-2.5 rounded" style={{ width: `${60 + (i * 37) % 200}px` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
