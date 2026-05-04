import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@swarmx/types";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider border",
  {
    variants: {
      variant: {
        default:
          "border-border bg-bg-elevated text-text-secondary",
        active:
          "border-status-active/30 bg-status-active/10 text-status-active",
        queued:
          "border-status-queued/30 bg-status-queued/10 text-status-queued",
        success:
          "border-status-success/30 bg-status-success/10 text-status-success",
        error:
          "border-status-error/30 bg-status-error/10 text-status-error",
        fatal:
          "border-status-fatal/30 bg-status-fatal/10 text-status-fatal",
        idle:
          "border-border bg-bg-surface text-text-muted",
        warn:
          "border-status-warning/30 bg-status-warning/10 text-status-warning",
        throttled:
          "border-status-throttled/30 bg-status-throttled/10 text-status-throttled",
        reload:
          "border-status-reload/30 bg-status-reload/10 text-status-reload",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span
          className="status-dot"
          data-status={variant ?? "default"}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}

/** Map AgentStatus to badge variant */
export function agentStatusVariant(
  status: AgentStatus
): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "active":       return "active";
    case "queued":
    case "activating":   return "queued";
    case "success":      return "success";
    case "error":
    case "failed":
    case "failed_permanent":
      return "error";
    case "oom_killed":   return "fatal";
    case "throttled":    return "throttled";
    case "reloading":    return "reload";
    case "idle":
    case "deactivating":
    default:             return "idle";
  }
}

export { Badge, badgeVariants };
