"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Save, RefreshCw, ExternalLink } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SwarmXConfig {
  backend: {
    port: number;
    host: string;
    sse: { flushIntervalMs: number; keepAliveIntervalMs: number };
  };
  telemetry: { pollIntervalMs: number };
  agents: { maxConcurrent: number; defaultTimeout: number };
  terminal: { maxSessions: number; sessionTimeoutMs: number };
  llm: { defaultModel: string; maxTokens: number };
}

interface SettingsField<T> {
  key: string;
  label: string;
  description: string;
  type: "number" | "string" | "boolean";
  get: (c: SwarmXConfig) => T;
  set: (c: SwarmXConfig, v: T) => SwarmXConfig;
  unit?: string;
}

// ── Settings Section ──────────────────────────────────────────────────────────

function SettingsSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[10px] font-mono text-text-muted uppercase tracking-widest px-4 pb-2">
        {title}
      </h2>
      <div className="divide-y divide-border border-t border-b border-border">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label,
  description,
  children,
}: {
  readonly label: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-8 px-4 py-3">
      <div className="min-w-0">
        <div className="text-xs font-mono text-text-primary">{label}</div>
        <div className="text-[10px] font-mono text-text-muted mt-0.5">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery<SwarmXConfig>({
    queryKey: ["swarmx-config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SwarmXConfig>;
    },
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<Partial<SwarmXConfig>>({});

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<SwarmXConfig>) => {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    onSuccess: () => {
      setDraft({});
      queryClient.invalidateQueries({ queryKey: ["swarmx-config"] });
    },
  });

  const hasDraft = Object.keys(draft).length > 0;

  if (isLoading || !config) {
    return (
      <div className="p-6 space-y-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 skeleton rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h1 className="text-sm font-mono font-semibold text-text-primary">Settings</h1>
        {hasDraft && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-text-muted">Unsaved changes</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDraft({})}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => saveMutation.mutate(draft)}
              disabled={saveMutation.isPending}
              className="gap-1.5"
            >
              <Save className="h-3 w-3" />
              {saveMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-6 space-y-6 max-w-2xl">
          {/* Backend settings */}
          <SettingsSection title="API Backend">
            <SettingsRow
              label="Backend Port"
              description="Fastify API server port (requires restart)"
            >
              <Input
                type="number"
                className="w-24 text-xs text-right tabular-nums"
                defaultValue={config.backend.port}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    backend: { ...config.backend, ...d.backend, port: parseInt(e.target.value, 10) },
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              label="SSE Flush Interval"
              description="How often the SSE stream flushes events to clients (ms)"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-24 text-xs text-right tabular-nums"
                  defaultValue={config.backend.sse.flushIntervalMs}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      backend: {
                        ...config.backend,
                        ...d.backend,
                        sse: { ...config.backend.sse, flushIntervalMs: parseInt(e.target.value, 10) },
                      },
                    }))
                  }
                />
                <span className="text-[10px] font-mono text-text-muted">ms</span>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* Telemetry */}
          <SettingsSection title="Telemetry">
            <SettingsRow
              label="Poll Interval"
              description="How often system metrics are sampled from systeminformation"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-24 text-xs text-right tabular-nums"
                  defaultValue={config.telemetry.pollIntervalMs}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      telemetry: { pollIntervalMs: parseInt(e.target.value, 10) },
                    }))
                  }
                />
                <span className="text-[10px] font-mono text-text-muted">ms</span>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* Agents */}
          <SettingsSection title="Agent Runtime">
            <SettingsRow
              label="Max Concurrent Agents"
              description="Maximum number of agents that can run simultaneously"
            >
              <Input
                type="number"
                className="w-24 text-xs text-right tabular-nums"
                defaultValue={config.agents.maxConcurrent}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    agents: { ...config.agents, ...d.agents, maxConcurrent: parseInt(e.target.value, 10) },
                  }))
                }
              />
            </SettingsRow>
            <SettingsRow
              label="Default Agent Timeout"
              description="Maximum execution time per agent before force-kill (ms)"
            >
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  className="w-24 text-xs text-right tabular-nums"
                  defaultValue={config.agents.defaultTimeout}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      agents: { ...config.agents, ...d.agents, defaultTimeout: parseInt(e.target.value, 10) },
                    }))
                  }
                />
                <span className="text-[10px] font-mono text-text-muted">ms</span>
              </div>
            </SettingsRow>
          </SettingsSection>

          {/* Terminal */}
          <SettingsSection title="Terminal">
            <SettingsRow
              label="Max PTY Sessions"
              description="Maximum concurrent terminal sessions (node-pty instances)"
            >
              <Input
                type="number"
                className="w-24 text-xs text-right tabular-nums"
                defaultValue={config.terminal.maxSessions}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    terminal: { ...config.terminal, ...d.terminal, maxSessions: parseInt(e.target.value, 10) },
                  }))
                }
              />
            </SettingsRow>
          </SettingsSection>

          {/* LLM */}
          <SettingsSection title="LLM">
            <SettingsRow
              label="Default Model"
              description="Default model used by the AI Composer and agents without explicit model config"
            >
              <Input
                className="w-48 text-xs"
                defaultValue={config.llm.defaultModel}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    llm: { ...config.llm, ...d.llm, defaultModel: e.target.value },
                  }))
                }
              />
            </SettingsRow>
          </SettingsSection>

          {/* Docs link */}
          <div className="flex items-center gap-1.5 pt-2">
            <ExternalLink className="h-3 w-3 text-text-muted" />
            <a
              href="https://github.com/swarmx/swarmx/blob/main/docs/CONFIG_REFERENCE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-text-muted hover:text-accent transition-colors duration-(--duration-micro)"
            >
              Full configuration reference →
            </a>
          </div>

          {/* Keyboard shortcuts reference */}
          <SettingsSection title="Keyboard Shortcuts">
            <div className="divide-y divide-border">
              {([
                { keys: ["⌘", "K"],      label: "Open command palette" },
                { keys: ["⌘", "1–6"],    label: "Jump to section" },
                { keys: ["⌘", "B"],      label: "Toggle sidebar" },
                { keys: ["⌘", "`"],      label: "Toggle terminal strip" },
                { keys: ["⌘", "T"],      label: "New terminal tab" },
                { keys: ["⌘", "⇧", "T"], label: "Toggle telemetry rail" },
                { keys: ["⌘", "⇧", "`"], label: "Fullscreen terminal" },
                { keys: ["↵"],           label: "Submit composer message" },
              ] as const).map(({ keys, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-4 py-2 hover:bg-bg-elevated/40 transition-colors duration-(--duration-micro)"
                >
                  <span className="text-xs font-mono text-text-secondary">{label}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k) => (
                      <kbd
                        key={k}
                        className="kbd-pill"
                      >
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
}
