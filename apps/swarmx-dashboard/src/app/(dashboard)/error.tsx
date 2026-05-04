"use client";

import React, { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardErrorProps {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <section className="max-w-xl rounded-2xl border border-status-error/30 bg-bg-surface p-6 shadow-[0_24px_48px_rgba(0,0,0,0.35)]">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-error" aria-hidden="true" />
          <div className="space-y-3">
            <div>
              <h1 className="text-lg font-semibold text-text-primary">Dashboard surface failed to render</h1>
              <p className="mt-1 text-sm text-text-secondary">
                SwarmX kept the operator shell alive, but this route hit a runtime error. Retry the panel first. If it fails again, refresh the console and inspect the API logs.
              </p>
            </div>
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2">
              <p className="text-[11px] font-mono text-text-muted">{error.message || "Unknown dashboard error"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="accent" className="gap-1.5" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" />
                Retry route
              </Button>
              <Button type="button" variant="ghost" onClick={() => globalThis.location.reload()}>
                Reload console
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
