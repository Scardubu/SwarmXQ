import * as React from "react";
import { cn } from "@/lib/utils";

type ProgressProps = React.ComponentPropsWithoutRef<"progress">;

const Progress = React.forwardRef<HTMLProgressElement, ProgressProps>(
  ({ className, value = 0, max = 100, ...props }, ref) => {
    const normalized = Math.max(0, Math.min(Number(max), Number(value)));
    return (
      <progress
        ref={ref}
        className={cn("h-2 w-full overflow-hidden rounded bg-bg-elevated accent-accent", className)}
        value={normalized}
        max={max}
        {...props}
      />
    );
  }
);

Progress.displayName = "Progress";

export { Progress };
