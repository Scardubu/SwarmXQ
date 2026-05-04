import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-8 w-full rounded border border-border bg-bg-input px-3 py-1.5",
          "font-ui text-sm text-text-primary placeholder:text-text-muted",
          "transition-colors duration-(--duration-micro)",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

export { Input };
