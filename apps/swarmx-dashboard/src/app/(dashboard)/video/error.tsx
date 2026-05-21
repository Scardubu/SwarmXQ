"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function VideoError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-text-primary">Video workspace failed to load</h2>
        <p className="max-w-md text-sm text-text-muted">{error.message}</p>
      </div>
      <button
        type="button"
        onClick={() => reset()}
        className="inline-flex items-center gap-2 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm text-text-primary hover:bg-bg-surface"
      >
        <RefreshCw className="h-4 w-4" aria-hidden />
        Retry
      </button>
    </div>
  );
}
