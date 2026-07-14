export default function VideoJobDetailLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col animate-pulse">
      <header className="border-b border-border bg-bg-surface/95 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="skeleton h-8 w-20" />
          <div className="skeleton h-3 w-32" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 overflow-y-auto p-4 sm:p-6 lg:grid-cols-[minmax(320px,55%)_minmax(280px,45%)]">
        <section className="space-y-4">
          <div className="rounded border border-border bg-bg-elevated p-3">
            <div className="skeleton mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-[420px]" />
          </div>

          <div className="space-y-3 rounded border border-border bg-bg-elevated p-4">
            <div className="skeleton h-3 w-20" />
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="skeleton h-3" />
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded border border-border bg-bg-elevated p-4">
            <div className="flex items-center justify-between">
              <div className="skeleton h-3 w-24" />
              <div className="skeleton h-3 w-10" />
            </div>
            <div className="skeleton h-1 w-full" />
            <div className="ml-2 space-y-2.5 border-l border-border pl-4">
              {[1, 2, 3, 4].map((index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="skeleton h-3 w-3 rounded-full" />
                  <div className="skeleton h-3" style={{ width: `${55 + index * 8}px` }} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="space-y-3 rounded border border-border bg-bg-elevated p-4">
            <div className="skeleton h-3 w-28" />
            <div className="skeleton h-24 w-full" />
          </div>
          <div className="space-y-3 rounded border border-border bg-bg-elevated p-4">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-20 w-full" />
          </div>
        </section>
      </div>
    </div>
  );
}
