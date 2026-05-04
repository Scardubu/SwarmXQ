export default function DashboardLoading() {
  return (
    <div className="p-4 md:p-6">
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-bg-surface p-4">
          <div className="mb-4 h-4 w-32 skeleton" />
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={`dashboard-loading-card-${index + 1}`} className="h-24 rounded-lg skeleton" />
            ))}
          </div>
        </section>
        <section className="rounded-xl border border-border bg-bg-surface p-4">
          <div className="mb-4 h-4 w-24 skeleton" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={`dashboard-loading-side-${index + 1}`} className="h-14 rounded-lg skeleton" />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
