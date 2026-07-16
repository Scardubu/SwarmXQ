import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes with clsx support. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format bytes to human-readable string (e.g. 1.2 MB). */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const dm = Math.max(0, decimals);
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, sizes.length - 1);
  return `${Number.parseFloat((bytes / Math.pow(k, idx ?? 0)).toFixed(dm))} ${sizes[idx] ?? "B"}`;
}

/** Format bytes/sec to human-readable throughput. */
export function formatBps(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Format a percent value with fixed decimals. */
export function formatPct(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/** Format relative timestamp (e.g. "2s ago", "3m ago"). */
export function formatRelativeTime(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format WAT timestamp (UTC+1, Nigerian timezone). */
export function formatWAT(timestampMs: number): string {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestampMs));
}

/** Determine resource color based on utilization percent. */
export function resourceColor(pct: number): string {
  if (pct < 60) return "var(--color-resource-safe)";
  if (pct < 85) return "var(--color-resource-warn)";
  return "var(--color-resource-critical)";
}

/** Map journald PRIORITY (0–7) to LogLevel. */
export function priorityToLogLevel(
  priority: string
): "fatal" | "error" | "warn" | "info" | "debug" {
  switch (priority) {
    case "0":
    case "1":
    case "2":
      return "fatal";
    case "3":
      return "error";
    case "4":
    case "5":
      return "warn";
    case "6":
      return "info";
    case "7":
    default:
      return "debug";
  }
}

/** Map AgentStatus to CSS custom property name for status color. */
export function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "var(--color-status-active)";
    case "queued":
    case "activating":
      return "var(--color-status-queued)";
    case "success":
      return "var(--color-status-success)";
    case "error":
    case "failed":
    case "failed_permanent":
      return "var(--color-status-error)";
    case "oom_killed":
      return "var(--color-status-fatal)";
    case "idle":
    case "inactive":
    case "deactivating":
      return "var(--color-status-idle)";
    case "throttled":
      return "var(--color-status-throttled)";
    case "reloading":
    case "reload":
      return "var(--color-status-reload)";
    default:
      return "var(--color-status-idle)";
  }
}

/** Generate a unique session ID for PTY tabs. */
export function generateSessionId(): string {
  return `pty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Extract a user-safe message from an unknown error. Guards against leaking
 * absolute paths, oversized internals, or non-Error thrown values into the UI.
 * Structured API error handling should still go through the dedicated
 * ApiError sanitizers in each store; this is the last-resort fallback.
 */
export function safeErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const message = err.message?.trim();
    if (!message) return fallback;
    if (message.length > 160) return fallback;
    if (message.includes("/") || message.includes("\\")) return fallback;
    return message;
  }
  if (typeof err === "string") {
    const trimmed = err.trim();
    if (!trimmed || trimmed.length > 160) return fallback;
    if (trimmed.includes("/") || trimmed.includes("\\")) return fallback;
    return trimmed;
  }
  return fallback;
}
