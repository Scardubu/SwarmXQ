"use client";

import { RotateCcw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeriesPassStatus } from "@swarmx/types/series-types";

type EpisodePass = "a" | "b" | "c" | "d";

interface PassDef {
  key: EpisodePass;
  label: string;
  title: string;
}

const PASSES: PassDef[] = [
  { key: "a", label: "A", title: "Script"  },
  { key: "b", label: "B", title: "Prompts" },
  { key: "c", label: "C", title: "Audio"   },
  { key: "d", label: "D", title: "Scoring" },
];

const STATUS_DOT: Record<SeriesPassStatus, string> = {
  complete: "bg-status-success",
  running:  "animate-pulse bg-accent",
  failed:   "bg-status-error",
  idle:     "bg-border",
};

interface PassStatusRowProps {
  passStatus: {
    passA: SeriesPassStatus;
    passB: SeriesPassStatus;
    passC: SeriesPassStatus;
    passD: SeriesPassStatus;
  };
  rerunningPass: EpisodePass | null;
  onRerun: (pass: EpisodePass) => void;
}

export function PassStatusRow({ passStatus, rerunningPass, onRerun }: PassStatusRowProps) {
  const statusOf = (pass: EpisodePass): SeriesPassStatus =>
    passStatus[`pass${pass.toUpperCase() as "A" | "B" | "C" | "D"}`];

  return (
    <div
      className="flex items-center gap-3 rounded border border-border bg-bg-surface px-3 py-2"
      aria-label="Episode pre-production passes"
      role="group"
    >
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">
        Passes
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-3">
        {PASSES.map(({ key, label, title }) => {
          const status = statusOf(key);
          const isRerunning = rerunningPass === key;
          const canRerun = (status === "complete" || status === "failed") && !rerunningPass;

          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className={cn("h-2 w-2 rounded-full shrink-0", STATUS_DOT[status])}
                aria-hidden="true"
              />
              <span className="font-mono text-[10px] text-text-muted">
                {label} — {title}
              </span>
              <span className={cn(
                "font-mono text-[10px]",
                status === "complete" && "text-status-success",
                status === "running"  && "text-accent",
                status === "failed"   && "text-status-error",
                status === "idle"     && "text-text-muted",
              )}>
                {status}
              </span>
              {canRerun && (
                <button
                  type="button"
                  onClick={() => onRerun(key)}
                  disabled={isRerunning || !!rerunningPass}
                  className={cn(
                    "ml-0.5 flex items-center gap-0.5 rounded border border-border px-1 py-0.5",
                    "font-mono text-[10px] text-text-muted hover:border-border-accent hover:text-text-primary",
                    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
                    "disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
                  )}
                  aria-label={`Regenerate pass ${label} (${title})`}
                >
                  {isRerunning
                    ? <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden="true" />
                    : <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
                  }
                  Regen
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
