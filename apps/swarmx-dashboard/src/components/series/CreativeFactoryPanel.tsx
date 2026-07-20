"use client";

import { useEffect, useMemo } from "react";
import { Activity, Boxes, CheckCircle2, GitBranch, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCreativeFactoryStore } from "@/stores/creative-factory";

function capabilityTone(state: string): string {
  if (state === "available") return "text-status-success";
  if (state === "degraded") return "text-status-warning";
  return "text-status-error";
}

export function CreativeFactoryPanel() {
  const {
    stages,
    runs,
    capabilities,
    brandKits,
    audiences,
    blueprints,
    isLoading,
    error,
    fetchFactory,
    createRun,
  } = useCreativeFactoryStore((state) => ({
    stages: state.stages,
    runs: state.runs,
    capabilities: state.capabilities,
    brandKits: state.brandKits,
    audiences: state.audiences,
    blueprints: state.blueprints,
    isLoading: state.isLoading,
    error: state.error,
    fetchFactory: state.fetchFactory,
    createRun: state.createRun,
  }));

  useEffect(() => {
    void fetchFactory();
  }, [fetchFactory]);

  const latestRun = runs[0];
  const stageSummary = useMemo(() => {
    const approvalCount = stages.filter((stage) => stage.humanApprovalRequired).length;
    const retryableCount = stages.filter((stage) => stage.retryable).length;
    return { approvalCount, retryableCount };
  }, [stages]);

  const startRun = async () => {
    await createRun({
      mode: "FULL_RENDER",
      profile: "constrained_cpu",
      idempotencyKey: `dashboard-${new Date().toISOString().slice(0, 19)}`,
    });
  };

  return (
    <section className="mb-5 rounded border border-border bg-bg-elevated/70" aria-labelledby="factory-heading">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <GitBranch className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="factory-heading" className="text-sm font-semibold text-text-primary">Creative Factory</h2>
            <p className="truncate text-xs text-text-muted">
              {stages.length} checkpointed stages · {stageSummary.approvalCount} approval gates · {stageSummary.retryableCount} retryable stages
            </p>
          </div>
        </div>
        <Button onClick={startRun} variant="outline" size="sm" disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Activity className="h-4 w-4" aria-hidden="true" />}
          Start Run
        </Button>
      </div>

      {error && (
        <div className="mx-4 mt-3 flex items-start gap-2 rounded border border-status-error/35 bg-status-error/10 px-3 py-2 text-xs text-status-error" role="alert">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid gap-0 divide-y divide-border md:grid-cols-[1.3fr_1fr] md:divide-x md:divide-y-0">
        <div className="grid grid-cols-2 gap-0 sm:grid-cols-4">
          {[
            { label: "Runs", value: runs.length, icon: Activity },
            { label: "BrandKits", value: brandKits.length, icon: ShieldCheck },
            { label: "Audiences", value: audiences.length, icon: Boxes },
            { label: "Blueprints", value: blueprints.length, icon: CheckCircle2 },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="min-h-20 border-r border-t border-border px-4 py-3 first:border-t-0 sm:border-t-0">
                <div className="mb-2 flex items-center gap-2 text-text-muted">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="font-mono text-[10px] uppercase tracking-wide">{item.label}</span>
                </div>
                <div className="font-mono text-xl text-text-primary">{item.value}</div>
              </div>
            );
          })}
        </div>

        <div className="flex min-h-20 flex-col gap-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Latest Run</span>
            <span className={cn("rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase", latestRun ? "text-text-secondary" : "text-text-muted")}>
              {latestRun?.status ?? "none"}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {capabilities.map((capability) => (
              <div key={capability.platform} className="flex min-w-0 items-center justify-between gap-2 rounded border border-border bg-bg-surface px-2 py-1.5">
                <span className="truncate text-text-secondary">{capability.platform}</span>
                <span className={cn("font-mono text-[10px]", capabilityTone(capability.supportsDirectPublish ? "available" : "degraded"))}>
                  {capability.supportsDirectPublish ? "direct" : "draft"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
