export default function WorkflowsLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden xl:grid xl:grid-cols-[1fr_2fr]">
      {/* Left — workflow list */}
      <section className="flex flex-col border-r border-border">
        <header className="border-b border-border px-4 py-3 flex items-center justify-between gap-2">
          <div className="skeleton h-4 w-32" />
          <div className="skeleton h-7 w-24 rounded" />
        </header>

        <div className="flex-1 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-border/50 px-4 py-3 space-y-1.5"
              style={{ opacity: 1 - i * 0.1 }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="skeleton h-3.5 w-40" />
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
              <div className="skeleton h-3 w-56" />
            </div>
          ))}
        </div>
      </section>

      {/* Right — run detail skeleton */}
      <section className="hidden xl:flex flex-col">
        <header className="border-b border-border px-5 py-3">
          <div className="skeleton h-4 w-36" />
        </header>
        <div className="flex-1 p-5 space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded border border-border bg-bg-elevated/60 p-4 space-y-2"
              style={{ opacity: 1 - i * 0.15 }}
            >
              <div className="flex items-center justify-between">
                <div className="skeleton h-3.5 w-24" />
                <div className="skeleton h-3 w-14" />
              </div>
              <div className="skeleton h-2.5 w-full" />
              <div className="skeleton h-2.5 w-2/3" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
