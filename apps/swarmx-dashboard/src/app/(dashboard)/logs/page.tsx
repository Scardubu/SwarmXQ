"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Download, ChevronDown } from "lucide-react";
import type { LogEntry, LogLevel } from "@swarmx/types";

// ── Log level config ──────────────────────────────────────────────────────────

const LOG_LEVEL_CONFIG: Record<
  LogLevel,
  { label: string; levelClassName: string; messageClassName: string }
> = {
  debug: { label: "DBG", levelClassName: "log-level-debug", messageClassName: "log-message-debug" },
  info: { label: "INF", levelClassName: "log-level-info", messageClassName: "log-message-info" },
  notice: { label: "NTC", levelClassName: "log-level-info", messageClassName: "log-message-info" },
  warn: { label: "WRN", levelClassName: "log-level-warning", messageClassName: "log-message-warning" },
  error: { label: "ERR", levelClassName: "log-level-error", messageClassName: "log-message-error" },
  fatal: { label: "FTL", levelClassName: "log-level-fatal", messageClassName: "log-message-fatal" },
  critical: { label: "CRT", levelClassName: "log-level-error", messageClassName: "log-message-error" },
  alert: { label: "ALT", levelClassName: "log-level-fatal", messageClassName: "log-message-fatal" },
  emergency: { label: "EMG", levelClassName: "log-level-fatal", messageClassName: "log-message-fatal" },
};

// ── Single log line (virtualized) ─────────────────────────────────────────────

const LogLine = React.memo(function LogLine({ entry }: { readonly entry: LogEntry }) {
  const cfg = LOG_LEVEL_CONFIG[entry.level];
  const time = new Date(entry.timestamp).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
    timeZone: "Africa/Lagos",
  });

  return (
    <div className="flex items-start gap-2 px-3 py-0.5 hover:bg-bg-elevated/50 font-mono text-[11px] leading-relaxed">
      <span className="shrink-0 text-text-muted tabular-nums w-28">{time}</span>
      <span className={cn("shrink-0 font-semibold tabular-nums w-7", cfg.levelClassName)}>
        {cfg.label}
      </span>
      {entry.unit && (
        <span className="shrink-0 text-text-muted max-w-25 truncate" title={entry.unit}>
          {entry.unit}
        </span>
      )}
      {entry.agentId && (
        <span className="shrink-0 text-status-reload text-[10px]">
          [{entry.agentId}]
        </span>
      )}
      <span className={cn("break-all whitespace-pre-wrap", cfg.messageClassName)}>
        {entry.message}
      </span>
    </div>
  );
});

// ── Log filters ───────────────────────────────────────────────────────────────

const LEVEL_FILTERS = [
  { value: "all",   label: "All" },
  { value: "warn",  label: "Warn+" },
  { value: "error", label: "Error+" },
] as const;

type LevelFilter = (typeof LEVEL_FILTERS)[number]["value"];

function passesLevelFilter(level: LogLevel, filter: LevelFilter): boolean {
  if (filter === "all") return true;
  // Complete severity order — fatal sits above error, below critical
  const ORDER: LogLevel[] = ["debug", "info", "notice", "warn", "error", "fatal", "critical", "alert", "emergency"];
  const idx = ORDER.indexOf(level);
  if (idx === -1) return true; // unknown level → always show
  const threshold = filter === "warn" ? ORDER.indexOf("warn") : ORDER.indexOf("error");
  return idx >= threshold;
}

// ── Main log explorer ─────────────────────────────────────────────────────────

export default function LogsPage() {
  const logs = useEventsStore((s) => s.logs);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter logs
  const filtered = useMemo(() => {
    let list = logs;
    if (levelFilter !== "all") {
      list = list.filter((l) => passesLevelFilter(l.level, levelFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (l) =>
          l.message.toLowerCase().includes(q) ||
          (l.unit ?? "").toLowerCase().includes(q) ||
          (l.agentId ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [logs, levelFilter, search]);

  // Auto-scroll to bottom when following
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, follow]);

  // Pause follow on manual scroll up
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (!atBottom && follow) setFollow(false);
    if (atBottom && !follow) setFollow(true);
  }, [follow]);

  const downloadLogs = useCallback(() => {
    const text = filtered.map((l) =>
      `${new Date(l.timestamp).toISOString()} [${l.level.toUpperCase()}] ${l.unit ?? ""} ${l.agentId ?? ""} ${l.message}`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `swarmx-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 pt-4 pb-2 space-y-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-text-primary">
            Unified Log Explorer
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted tabular-nums" data-metric>
              {filtered.length.toLocaleString()} / {logs.length.toLocaleString()} lines
            </span>
            <Button size="icon-sm" variant="ghost" onClick={downloadLogs} title="Download filtered logs">
              <Download className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Level filter */}
          <Tabs value={levelFilter} onValueChange={(v) => setLevelFilter(v as LevelFilter)}>
            <TabsList>
              {LEVEL_FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>{f.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages, units, or agents..."
              className="pl-8 text-xs"
            />
          </div>

          {/* Follow toggle */}
          <button
            type="button"
            onClick={() => setFollow(!follow)}
            aria-pressed={follow}
            aria-label={follow ? "Disable auto-scroll" : "Enable auto-scroll to latest"}
            className={cn(
              "flex items-center gap-1.5 px-2 h-7 rounded text-[10px] font-mono border",
              "transition-colors duration-(--duration-micro)",
              follow
                ? "border-accent text-accent bg-(--color-accent-dim)"
                : "border-border text-text-muted hover:border-border-active"
            )}
          >
            <ChevronDown className="h-3 w-3" />
            Follow
          </button>
        </div>
      </div>

      {/* Log lines */}
      {/* [V6.1-FIX-11] Keep header outside scrolling container to avoid
          sticky scroll-linked positioning warnings on Firefox/APZ. */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-border bg-bg-surface z-10 shrink-0">
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wide shrink-0 w-28">Time (WAT)</span>
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wide shrink-0 w-7">Lvl</span>
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wide shrink-0 max-w-25">Unit</span>
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wide shrink-0 w-20">Agent</span>
          <span className="text-[9px] font-mono text-text-muted uppercase tracking-wide">Message</span>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-bg-base"
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="System log output"
      >
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <span className="text-xs font-mono text-text-muted">
              {logs.length === 0 ? "The swarm is quiet — logs will stream here in real-time once agents are active" : "No logs match your filter — try a broader search"}
            </span>
          </div>
        ) : (
          <>
            {filtered.map((entry, i) => (
              <LogLine key={entry.id ?? `${entry.timestamp}-${i}`} entry={entry} />
            ))}
            {/* Scroll anchor */}
            <div id="log-bottom" />
          </>
        )}
      </div>
    </div>
  );
}
