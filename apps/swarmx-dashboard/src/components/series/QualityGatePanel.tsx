"use client";

import { CheckCircle2, XCircle, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QualityGateResult, QualityGateCategory } from "@swarmx/types/series-types";

const CATEGORY_LABELS: Record<QualityGateCategory, string> = {
  STORY_INTEGRITY:      "Story Integrity",
  CREATIVE_QUALITY:     "Creative Quality",
  VISUAL_CONSISTENCY:   "Visual Consistency",
  PRODUCTION_READINESS: "Production Readiness",
};

const CATEGORY_ORDER: QualityGateCategory[] = [
  "STORY_INTEGRITY",
  "CREATIVE_QUALITY",
  "VISUAL_CONSISTENCY",
  "PRODUCTION_READINESS",
];

interface QualityGatePanelProps {
  result: QualityGateResult;
}

export function QualityGatePanel({ result }: QualityGatePanelProps) {
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    checks: result.checks.filter((c) => c.category === cat),
  })).filter((g) => g.checks.length > 0);

  return (
    <section aria-label="Quality gate results" className="space-y-3">
      {/* Overall banner */}
      <div
        className={cn(
          "flex items-center gap-2 rounded border px-3 py-2.5",
          result.passed
            ? "border-status-success/35 bg-status-success/10"
            : "border-status-error/35 bg-status-error/10",
        )}
        role="status"
        aria-live="polite"
      >
        {result.passed ? (
          <ShieldCheck className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
        ) : (
          <ShieldAlert className="h-4 w-4 shrink-0 text-status-error" aria-hidden="true" />
        )}
        <span className={cn(
          "text-sm font-medium",
          result.passed ? "text-status-success" : "text-status-error",
        )}>
          {result.passed
            ? "All checks passed — episode is production-ready"
            : `${result.checks.filter((c) => !c.passed).length} check(s) failed — revise before producing`}
        </span>
      </div>

      {/* Grouped checklist */}
      <div className="space-y-2">
        {grouped.map(({ category, label, checks }) => (
          <div key={category} className="rounded border border-border bg-bg-surface">
            <div className="border-b border-border px-3 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {label}
              </span>
            </div>
            <ul className="divide-y divide-border">
              {checks.map((check, idx) => (
                <li key={idx} className="flex items-start gap-2 px-3 py-2">
                  {check.passed ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-error" aria-hidden="true" />
                  )}
                  <div className="min-w-0">
                    <p className={cn(
                      "text-xs",
                      check.passed ? "text-text-secondary" : "text-text-primary font-medium",
                    )}>
                      {check.label}
                    </p>
                    {check.detail && (
                      <p className="mt-0.5 text-[11px] text-status-error/80">
                        {check.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
