/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/[id]/error.tsx
 *
 * Error boundary for the individual video job detail route.
 * Mirrors the parent video/error.tsx but scoped to job-level failures
 * (e.g. 404 from the job detail fetch, SSE subscription errors).
 */

"use client";

import { useEffect } from "react";
import Link from "next/link";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function VideoJobDetailError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[VideoJobDetail] Error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-6 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-950/50 border border-red-900/50 flex items-center justify-center">
        <svg
          className="w-7 h-7 text-red-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.362a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-base font-semibold text-zinc-200">
          Job detail failed to load
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          {error.message || "An unexpected error occurred loading this video job."}
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono text-zinc-700">
            digest: {error.digest}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          aria-label="Retry loading video job detail"
          className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-medium px-4 py-2.5 transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Try again
        </button>

        <Link
          href="/video"
          className="flex items-center gap-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-sm font-medium px-4 py-2.5 transition-colors"
        >
          ← Back to jobs
        </Link>
      </div>
    </div>
  );
}
