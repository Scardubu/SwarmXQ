export default function SettingsLoading() {
  return (
    <div className="flex h-full flex-col overflow-auto px-4 py-6 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Page header */}
        <div className="space-y-1.5">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton h-3.5 w-64" />
        </div>

        {/* Config panel */}
        <div className="rounded border border-border space-y-0">
          {/* Header */}
          <div className="border-b border-border px-4 py-3 flex items-center justify-between">
            <div className="skeleton h-4 w-40" />
            <div className="skeleton h-7 w-16 rounded" />
          </div>
          {/* Key/value rows */}
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border/50 px-4 py-3 flex items-center gap-4"
              style={{ opacity: 1 - i * 0.08 }}
            >
              <div className="skeleton h-3.5 w-44 shrink-0" />
              <div className="skeleton h-7 flex-1 rounded" />
            </div>
          ))}
        </div>

        {/* Model topology card */}
        <div className="rounded border border-border">
          <div className="border-b border-border px-4 py-3">
            <div className="skeleton h-4 w-36" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border/50 px-4 py-2.5 flex items-center gap-3"
              style={{ opacity: 1 - i * 0.12 }}
            >
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-3 w-48" />
              <div className="skeleton h-3 w-16 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
