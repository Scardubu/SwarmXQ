/**
 * apps/swarmx-dashboard/src/app/(dashboard)/video/error.tsx
 */

"use client";

import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function VideoError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error("[VideoPage] Error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-6 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-950/50 border border-red-900/50 flex items-center justify-center">
        <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
          />
        </svg>
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-base font-semibold text-zinc-200">
          Video page failed to load
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed">
          {error.message || "An unexpected error occurred rendering the video workspace."}
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono text-zinc-700">
            digest: {error.digest}
          </p>
        )}
      </div>

      <button
        onClick={reset}
        className="flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 text-sm font-medium px-4 py-2.5 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        Try again
      </button>
    </div>
  );
}