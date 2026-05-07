"use client";

import React, { Suspense, useMemo, useState } from "react";
import { cn, formatPct, formatBytes } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { useSearchParams } from "next/navigation";
import { agentStatusVariant, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Search, Terminal as TerminalIcon } from "lucide-react";
import type { AgentState } from "@swarmx/types";
import { useUIStore } from "@/stores/ui";

// ── Helpers ───────────────────────────────────────────────────────────────────

function agentDataStatus(status: AgentState["status"]): string {
  if (status === "running") return "active";
  if (status === "idle") return "idle";
  if (status === "queued") return "queued";
  if (status === "error" || status === "fatal") return "error";
  if (status === "success") return "success";
  if (status === "throttled") return "throttled";
  return "idle";
}

// ── Status filter tabs ────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { label: "All",       value: "all" },
  { label: "Running",   value: "running" },
  { label: "Idle",      value: "idle" },
  { label: "Queued",    value: "queued" },
  { label: "Error",     value: "error" },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

// ── Agent table ───────────────────────────────────────────────────────────────

function AgentRow({
  agent,
  onSelect,
}: {
  readonly agent: AgentState;
  readonly onSelect: (a: AgentState) => void;
}) {
  // Normalise the resource/resources alias — API may send either field
  const res = agent.resources ?? agent.resource ?? null;
  const cpuPct = res?.cpuPercent ?? 0;
  const memMb = res?.memoryMb ?? res?.memRssMb ?? 0;
  const throttled = (res?.cpuThrottledPercent ?? 0) > 10;
  const oomEvents = res?.oomEvents ?? 0;
  let cpuClassName = "text-text-secondary";
  if (cpuPct > 85) {
    cpuClassName = "text-status-error";
  } else if (cpuPct > 60) {
    cpuClassName = "text-status-warning";
  }

  return (
    <button
      onClick={() => onSelect(agent)}
      className={cn(
        "w-full grid items-center gap-3 px-4 py-2.5 text-left",
        "hover:bg-bg-elevated transition-colors duration-(--duration-micro)",
        "focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-1 focus-visible:ring-accent",
        "border-b border-border last:border-0",
        "grid-cols-[1.5rem_1fr_5rem_5rem_5rem_7rem_4rem]"
      )}
      aria-label={`View details for ${agent.name ?? agent.id}`}
    >
      {/* Status dot */}
      <span
        className="status-dot h-2 w-2 shrink-0"
        data-status={agentDataStatus(agent.status)}
      />

      {/* Name + role */}
      <div className="min-w-0">
        <div className="text-xs font-mono text-text-primary truncate">
          {agent.name ?? agent.id}
          {oomEvents > 0 && (
            <span className="ml-1.5 text-[9px] text-status-error">OOM×{oomEvents}</span>
          )}
        </div>
        <div className="text-[10px] font-mono text-text-muted truncate">{agent.role}</div>
      </div>

      {/* Status badge */}
      <Badge variant={agentStatusVariant(agent.status)} className="w-fit text-[9px]">
        {agent.status}
      </Badge>

      {/* CPU */}
      <span
        className={cn("text-xs font-mono tabular-nums text-right", cpuClassName)}
        data-metric
      >
        {formatPct(cpuPct)}
        {throttled && <span className="text-[9px] text-status-warning ml-0.5">↓</span>}
      </span>

      {/* Memory */}
      <span className="text-xs font-mono tabular-nums text-right text-text-secondary" data-metric>
        {formatBytes(memMb * 1024 * 1024)}
      </span>

      {/* Current task */}
      <span className="text-[10px] font-mono text-text-muted truncate">
        {agent.currentTask ?? "—"}
      </span>

      {/* Duration */}
      <span className="text-[10px] font-mono text-text-muted text-right">
        {agent.startedAt
          ? formatDuration(Date.now() - new Date(agent.startedAt).getTime())
          : "—"}
      </span>
    </button>
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h${m % 60}m`;
  if (m > 0) return `${m}m${s % 60}s`;
  return `${s}s`;
}

// ── Agent detail sheet ────────────────────────────────────────────────────────

function AgentDetailSheet({
  agent,
  onClose,
}: {
  readonly agent: AgentState | null;
  readonly onClose: () => void;
}) {
  const addTerminalTab = useUIStore((s) => s.addTerminalTab);
  const toggleTerminal = useUIStore((s) => s.toggleTerminal);

  const openAgentTerminal = () => {
    if (!agent) return;
    addTerminalTab(`agent:${agent.name ?? agent.id}`, agent.id);
    toggleTerminal();
    onClose();
  };

  return (
    <Sheet open={agent !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right">
        {agent && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <span
                  className="status-dot h-2.5 w-2.5"
                  data-status={agentDataStatus(agent.status)}
                />
                <SheetTitle>{agent.name ?? agent.id}</SheetTitle>
              </div>
              <SheetDescription>{agent.role}</SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-6">
                {/* Status + Actions */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant={agentStatusVariant(agent.status)}>{agent.status}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={openAgentTerminal}
                    className="gap-1.5"
                  >
                    <TerminalIcon className="h-3 w-3" />
                    Attach Terminal
                  </Button>
                </div>

                {/* Resource metrics */}
                {(() => {
                  const res = agent.resources ?? agent.resource ?? null;
                  return (
                    <section>
                      <h4 className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">
                        Resources
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        <DetailMetric label="CPU" value={formatPct(res?.cpuPercent ?? 0)} alert={(res?.cpuPercent ?? 0) > 85} />
                        <DetailMetric label="Memory" value={formatBytes((res?.memoryMb ?? res?.memRssMb ?? 0) * 1024 * 1024)} />
                        <DetailMetric label="Throttled" value={formatPct(res?.cpuThrottledPercent ?? 0)} alert={(res?.cpuThrottledPercent ?? 0) > 10} />
                        <DetailMetric label="OOM Events" value={String(res?.oomEvents ?? 0)} alert={(res?.oomEvents ?? 0) > 0} />
                        {res?.ioReadBytes != null && (
                          <DetailMetric label="I/O Read" value={formatBytes(res.ioReadBytes)} />
                        )}
                        {res?.ioWriteBytes != null && (
                          <DetailMetric label="I/O Write" value={formatBytes(res.ioWriteBytes)} />
                        )}
                      </div>
                    </section>
                  );
                })()}

                {/* Current task */}
                {agent.currentTask && (
                  <section>
                    <h4 className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">
                      Current Task
                    </h4>
                    <p className="text-xs font-mono text-text-secondary">{agent.currentTask}</p>
                  </section>
                )}

                {/* Last error */}
                {agent.lastError && (
                  <section>
                    <h4 className="text-[10px] font-mono text-status-error uppercase tracking-widest mb-2">
                      Last Error
                    </h4>
                    <pre className="text-[10px] font-mono text-status-error bg-status-error/5 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                      {agent.lastError}
                    </pre>
                  </section>
                )}

                {/* Metadata */}
                <section>
                  <h4 className="text-[10px] font-mono text-text-muted uppercase tracking-widest mb-2">
                    Metadata
                  </h4>
                  <div className="space-y-1">
                    <KeyValue label="ID" value={agent.id} />
                    <KeyValue label="Model" value={agent.model ?? "—"} />
                    <KeyValue label="Started" value={agent.startedAt ? new Date(agent.startedAt).toLocaleString("en-NG", { timeZone: "Africa/Lagos" }) : "—"} />
                    <KeyValue label="PID" value={agent.pid == null ? "—" : String(agent.pid)} />
                    <KeyValue label="cgroup" value={agent.cgroupPath ?? "—"} />
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailMetric({ label, value, alert }: { readonly label: string; readonly value: string; readonly alert?: boolean }) {
  return (
    <div className="bg-bg-elevated rounded p-2">
      <div className="text-[9px] font-mono text-text-muted uppercase tracking-wide">{label}</div>
      <div
        className={cn("text-sm font-mono tabular-nums font-medium mt-0.5", alert ? "text-status-error" : "text-text-primary")}
        data-metric
      >
        {value}
      </div>
    </div>
  );
}

function KeyValue({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] font-mono text-text-muted w-16 shrink-0">{label}</span>
      <span className="text-[10px] font-mono text-text-secondary break-all">{value}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AgentsPageContent() {
  const agentsMap = useEventsStore((s) => s.agents);
  const agents = useMemo(() => [...agentsMap.values()], [agentsMap]);
  const searchParams = useSearchParams();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedAgent, setSelectedAgent] = useState<AgentState | null>(null);

  // Auto-focus agent from URL param (from command palette)
  React.useEffect(() => {
    const focusId = searchParams.get("focus");
    if (focusId) {
      const agent = agents.find((a) => a.id === focusId);
      if (agent) setSelectedAgent(agent);
    }
  }, [searchParams, agents]);

  const filtered = useMemo(() => {
    let list = agents;
    if (statusFilter !== "all") {
      list = list.filter((a) =>
        statusFilter === "error" ? (a.status === "error" || a.status === "fatal") : a.status === statusFilter
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(q) ||
          (a.name ?? "").toLowerCase().includes(q) ||
          (a.role ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [agents, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    return {
      all: agents.length,
      running: agents.filter((a) => a.status === "running").length,
      idle: agents.filter((a) => a.status === "idle").length,
      queued: agents.filter((a) => a.status === "queued").length,
      error: agents.filter((a) => a.status === "error" || a.status === "fatal").length,
    };
  }, [agents]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 pt-4 pb-2 space-y-3 border-b border-border">
        <div className="flex items-center justify-between">
          <h1 className="text-sm font-mono font-semibold text-text-primary">Agent Fleet</h1>
          <span className="text-xs font-mono text-text-muted tabular-nums" data-metric>
            {filtered.length} of {agents.length}
          </span>
        </div>

        {/* Status filter tabs */}
        <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <TabsList>
            {STATUS_FILTERS.map((f) => (
              <TabsTrigger key={f.value} value={f.value}>
                {f.label}
                <span className="text-[9px] tabular-nums" data-metric>
                  {counts[f.value]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by name, role, or ID..."
            className="pl-8 text-xs"
          />
        </div>
      </div>

      {/* Table header */}
      <div
        className="grid items-center gap-3 px-4 py-1.5 border-b border-border bg-bg-surface grid-cols-[1.5rem_1fr_5rem_5rem_5rem_7rem_4rem]"
      >
        {["", "Agent", "Status", "CPU", "Mem", "Task", "Uptime"].map((h) => (
          <span key={h} className="text-[9px] font-mono text-text-muted uppercase tracking-wide">
            {h}
          </span>
        ))}
      </div>

      {/* Agent rows */}
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <span className="text-xs font-mono text-text-muted">
              {agents.length === 0 ? "No agents registered" : "No agents match filter"}
            </span>
          </div>
        ) : (
          filtered.map((agent) => (
            <AgentRow key={agent.id} agent={agent} onSelect={setSelectedAgent} />
          ))
        )}
      </ScrollArea>

      {/* Agent detail sheet */}
      <AgentDetailSheet agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </div>
  );
}

function AgentsPageFallback() {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 pt-4 pb-2">
        <div className="h-6 w-36 skeleton" />
      </div>
      <div className="flex-1 p-4 space-y-2">
        <div className="h-8 w-full skeleton" />
        <div className="h-8 w-full skeleton" />
        <div className="h-8 w-full skeleton" />
        <div className="h-8 w-full skeleton" />
      </div>
    </div>
  );
}

export default function AgentsPage() {
  return (
    <Suspense fallback={<AgentsPageFallback />}>
      <AgentsPageContent />
    </Suspense>
  );
}
