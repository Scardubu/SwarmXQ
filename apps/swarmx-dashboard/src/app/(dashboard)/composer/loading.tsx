export default function ComposerLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Preset pills row */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-2 overflow-hidden">
        {[80, 100, 80, 96, 72].map((w, i) => (
          <div key={i} className="skeleton h-6 shrink-0 rounded-full" style={{ width: `${w}px` }} />
        ))}
      </div>

      {/* Message area */}
      <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-4">
        {/* Simulated assistant bubble */}
        <div className="flex items-start gap-3 max-w-xl">
          <div className="skeleton h-7 w-7 shrink-0 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <div className="skeleton h-3.5 w-48" />
            <div className="skeleton h-3.5 w-64" />
            <div className="skeleton h-3.5 w-40" />
          </div>
        </div>

        {/* Simulated user bubble */}
        <div className="flex items-start gap-3 max-w-xl self-end flex-row-reverse">
          <div className="skeleton h-7 w-7 shrink-0 rounded-full" />
          <div className="space-y-1.5">
            <div className="skeleton h-3.5 w-56" />
            <div className="skeleton h-3.5 w-36" />
          </div>
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-border px-4 py-3 flex items-center gap-2">
        <div className="skeleton h-9 flex-1 rounded" />
        <div className="skeleton h-9 w-9 shrink-0 rounded" />
      </div>
    </div>
  );
}
