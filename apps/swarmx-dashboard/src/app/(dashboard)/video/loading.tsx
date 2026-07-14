export default function VideoLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-border bg-bg-surface/80 px-4 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="skeleton h-4 w-36" />
            <div className="skeleton h-3 w-56" />
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <div className="skeleton h-6 w-20" />
            <div className="skeleton h-6 w-20" />
            <div className="skeleton h-6 w-16" />
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(360px,540px)_1fr]">
        <section className="space-y-4 overflow-y-auto border-b border-border p-4 sm:p-5 xl:border-b-0 xl:border-r">
          <div className="rounded border border-border bg-bg-elevated/80 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="skeleton h-4 w-32" />
              <div className="skeleton h-6 w-20" />
            </div>
            <div className="skeleton h-28 w-full" />
            <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="skeleton h-9" />
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <div className="skeleton h-9 w-36" />
            </div>
          </div>

          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="space-y-3 rounded border border-border bg-bg-elevated/60 p-4"
              style={{ opacity: 1 - index * 0.16 }}
            >
              <div className="flex items-center gap-2">
                <div className="skeleton h-4 w-14" />
                <div className="skeleton h-3 w-16" />
              </div>
              <div className="skeleton h-3 w-full" />
              <div className="skeleton h-3 w-4/5" />
              <div className="skeleton h-1 w-full" />
            </div>
          ))}
        </section>

        <aside className="hidden items-center justify-center px-8 text-center xl:flex">
          <div className="space-y-3">
            <div className="skeleton mx-auto h-14 w-14" />
            <div className="skeleton mx-auto h-3 w-40" />
          </div>
        </aside>
      </div>
    </div>
  );
}
