"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";

/**
 * Small always-visible indicator of the current client/operator disclosure
 * mode. Place this next to any header that gates content on
 * `operatorViewMode` (e.g. Operator Trace, Telemetry rail) so users always
 * know why a section is hidden or visible, without having to check the
 * CommandBar toggle.
 */
export function DisclosureModeBadge({ className }: { readonly className?: string }) {
  const operatorViewMode = useUIStore((s) => s.operatorViewMode);
  const isOperator = operatorViewMode === "operator";

  return (
    <Badge
      variant={isOperator ? "throttled" : "idle"}
      dot
      className={cn("shrink-0", className)}
      title={
        isOperator
          ? "Operator view — internal traces and token ceilings visible (⌘⇧O to switch)"
          : "Client view — internal traces and token ceilings hidden (⌘⇧O to switch)"
      }
    >
      {isOperator ? "Operator" : "Client"}
    </Badge>
  );
}
