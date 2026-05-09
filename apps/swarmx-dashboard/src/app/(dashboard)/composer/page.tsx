"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Send, Bot, Sparkles, RefreshCw, FolderOpen, Pin,
  Cpu, Database, AlertCircle, GitBranch, Activity,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ComposerMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  agentId?: string;
}

interface ComposerState {
  messages: ComposerMessage[];
  isLoading: boolean;
  sessionId: string;
}

function resolveDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SWARMX_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:3001";
}

const COMPOSER_RECENT_SCOPES_KEY = "swarmx:composer:recent-scopes";
const DEFAULT_PROJECT_SCOPE =
  process.env.NEXT_PUBLIC_SWARMX_PROJECT_PATH ?? "/home/scar/Downloads/SwarmX-1.5";

// ── Dynamic preset prompts based on fleet state ───────────────────────────────

function useDynamicPresets() {
  const agents = useEventsStore((s) => [...s.agents.values()]);
  const queues = useEventsStore((s) => s.queues);
  const errors = useEventsStore((s) => s.errorAgentCount);
  const active = useEventsStore((s) => s.activeAgentCount);

  return React.useMemo(() => {
    const presets: { icon: React.ElementType; label: string; prompt: string; highlight?: boolean }[] = [];

    if (errors > 0) {
      presets.push({
        icon: AlertCircle,
        label: `Diagnose ${errors} error${errors > 1 ? "s" : ""}`,
        prompt: "Find all agents in error state and describe their last error message and possible cause.",
        highlight: true,
      });
    }

    const totalWaiting = [...(queues?.values() ?? [])].reduce((a, q) => a + q.waiting, 0);
    if (totalWaiting > 10) {
      presets.push({
        icon: Database,
        label: `Explain queue pressure (${totalWaiting} waiting)`,
        prompt: `Queue depth is at ${totalWaiting}. Summarize current queue state and suggest how to reduce pressure.`,
        highlight: true,
      });
    }

    presets.push(
      { icon: Activity,   label: "Summarize fleet status",           prompt: "List all running agents and their current tasks, grouped by role." },
      { icon: Cpu,        label: "Find high-CPU agents",             prompt: "Show me agents with CPU usage above 80% and what they're working on." },
      { icon: GitBranch,  label: "Recent workflow runs",             prompt: "What workflows have run in the last hour? Show success/fail breakdown." },
      { icon: Database,   label: "Queue depth across all queues",    prompt: "Summarize the current queue depth across all BullMQ queues." },
      { icon: Bot,        label: "Idle agents report",               prompt: `${active} agents are active. How many are idle and why aren't they assigned tasks?` },
      { icon: AlertCircle,label: "OOM risk assessment",              prompt: "Show OOM events in the swarmx.slice cgroup and assess memory risk." },
    );

    return presets.slice(0, 6);
  }, [agents, queues, errors, active]);
}

// ── Typewriter welcome ────────────────────────────────────────────────────────

const WELCOME_LINES = [
  "Query your fleet in plain English.",
  "Diagnose errors before they cascade.",
  "Orchestrate agents with a sentence.",
  "Ask anything. The swarm is listening.",
];

function WelcomeTypewriter() {
  const [lineIndex, setLineIndex] = React.useState(0);
  const [displayed, setDisplayed] = React.useState("");
  const [isDeleting, setIsDeleting] = React.useState(false);

  React.useEffect(() => {
    const target = WELCOME_LINES[lineIndex] ?? "";

    if (!isDeleting && displayed === target) {
      const pause = setTimeout(() => setIsDeleting(true), 2400);
      return () => clearTimeout(pause);
    }

    if (isDeleting && displayed === "") {
      setIsDeleting(false);
      setLineIndex((i) => (i + 1) % WELCOME_LINES.length);
      return;
    }

    const speed = isDeleting ? 28 : 52;
    const timer = setTimeout(() => {
      setDisplayed((prev) =>
        isDeleting ? prev.slice(0, -1) : target.slice(0, prev.length + 1)
      );
    }, speed);
    return () => clearTimeout(timer);
  }, [displayed, isDeleting, lineIndex]);

  return (
    <span className="text-xs font-mono text-text-secondary typewriter-cursor">
      {displayed}
    </span>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { readonly msg: ComposerMessage }) {
  const isUser = msg.role === "user";
  const time = new Date(msg.timestamp).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });

  return (
    <div className={cn("flex gap-3 px-4 py-3 panel-enter", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "h-6 w-6 rounded-full shrink-0 flex items-center justify-center mt-0.5",
          isUser ? "bg-accent/20 text-accent" : "bg-(--color-accent-dim) text-text-secondary"
        )}
      >
        {isUser ? (
          <span className="text-[9px] font-mono font-bold">YOU</span>
        ) : (
          <Bot className="h-3 w-3" />
        )}
      </div>

      {/* Content */}
      <div className={cn("max-w-[75%] space-y-1", isUser ? "items-end" : "items-start")}>
        {msg.agentId && (
          <div className={cn("text-[9px] font-mono text-text-muted", isUser ? "text-right" : "text-left")}>
            {msg.agentId}
          </div>
        )}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-mono leading-relaxed",
            isUser
              ? "bg-(--color-accent-dim) text-accent border border-accent/20 text-right"
              : "bg-bg-elevated text-text-secondary border border-border"
          )}
        >
          <pre className="whitespace-pre-wrap font-mono">{msg.content}</pre>
        </div>
        <div className={cn("text-[9px] font-mono text-text-muted", isUser ? "text-right" : "text-left")}>
          {time}
        </div>
      </div>
    </div>
  );
}

// ── Thinking indicator ────────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 panel-enter">
      <div className="h-6 w-6 rounded-full bg-(--color-accent-dim) flex items-center justify-center shrink-0">
        <Bot className="h-3 w-3 text-accent animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5 bg-bg-elevated border border-border rounded-lg px-3 py-2">
        <div className="think-dot" />
        <div className="think-dot" />
        <div className="think-dot" />
        <span className="text-[10px] font-mono text-text-muted ml-1">thinking…</span>
      </div>
    </div>
  );
}

// ── Preset suggestion chips ───────────────────────────────────────────────────

function PresetChips({ onSelect }: { readonly onSelect: (p: string) => void }) {
  const presets = useDynamicPresets();

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-3 w-3 text-accent" />
        <span className="text-[9px] font-mono text-text-muted uppercase tracking-widest">
          Suggested queries
        </span>
        <span className="ai-chip ml-auto">AI</span>
      </div>
      <div className="composer-suggestions">
        {presets.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.prompt}
              onClick={() => onSelect(p.prompt)}
              className={cn(
                "composer-suggestion-chip",
                p.highlight && "border-accent/30 bg-accent/5 text-accent/80"
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="h-2.5 w-2.5 shrink-0" />
                <span className="font-semibold">{p.label}</span>
              </div>
              <span className="text-[9px] opacity-70 leading-relaxed">
                {p.prompt.length > 72 ? p.prompt.slice(0, 69) + "…" : p.prompt}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ComposerPage() {
  const agents = useEventsStore((s) => s.agents);
  const [state, setState] = useState<ComposerState>({
    messages: [],
    isLoading: false,
    sessionId: "composer-main",
  });
  const [input, setInput] = useState("");
  const [projectScope, setProjectScope] = useState(DEFAULT_PROJECT_SCOPE);
  const [recentScopes, setRecentScopes] = useState<string[]>([]);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    try {
      const raw = globalThis.localStorage.getItem(COMPOSER_RECENT_SCOPES_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed)) {
        setRecentScopes(parsed.filter((v) => typeof v === "string" && v.length > 0).slice(0, 5));
      }
    } catch { /* Ignore */ }
  }, []);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages.length]);

  const saveProjectScope = React.useCallback((scope: string) => {
    const trimmed = scope.trim();
    if (!trimmed) return;
    setRecentScopes((prev) => {
      const next = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 5);
      try {
        globalThis.localStorage.setItem(COMPOSER_RECENT_SCOPES_KEY, JSON.stringify(next));
      } catch { /* non-fatal */ }
      return next;
    });
  }, []);

  const sendMessage = React.useCallback(async (content: string) => {
    if (!content.trim() || state.isLoading) return;

    const userMsg: ComposerMessage = {
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    setState((prev) => ({ ...prev, messages: [...prev.messages, userMsg], isLoading: true }));
    setInput("");

    try {
      const payload = {
        sessionId: state.sessionId,
        message: content.trim(),
        context: {
          projectScope: projectScope.trim() || undefined,
          recentProjects: recentScopes,
          agents: [...agents.entries()].map(([id, a]) => ({
            id,
            name: a.name,
            status: a.status,
            role: a.role,
          })),
        },
      };

      const requestInit: RequestInit = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };

      let res = await fetch("/api/composer/chat", requestInit);
      if (!res.ok && res.status >= 500) {
        const fallbackUrl = `${resolveDirectApiBaseUrl()}/api/composer/chat`;
        res = await fetch(fallbackUrl, requestInit);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json() as { message: string; agentId?: string };

      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            role: "assistant",
            content: data.message,
            timestamp: Date.now(),
            ...(data.agentId !== undefined && { agentId: data.agentId }),
          },
        ],
        isLoading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          {
            role: "assistant",
            content: `Couldn't reach the swarm brain: ${err instanceof Error ? err.message : "Unknown error"}.\n\nMake sure the API server is running at the configured endpoint.`,
            timestamp: Date.now(),
          },
        ],
        isLoading: false,
      }));
    }
  }, [state.sessionId, state.isLoading, agents, projectScope, recentScopes]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const runningCount = [...agents.values()].filter((a) => a.status === "running").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Sparkles className="h-4 w-4 text-accent" />
            {runningCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-accent beacon-active" />
            )}
          </div>
          <h1 className="text-sm font-mono font-semibold text-text-primary">AI Composer</h1>
          <span className="text-[10px] font-mono text-text-muted">
            {runningCount > 0
              ? `${runningCount} agent${runningCount === 1 ? "" : "s"} available`
              : "Fleet standing by"}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setState({ messages: [], isLoading: false, sessionId: `composer-${Date.now()}` })}
          className="gap-1.5 text-text-muted hover:text-text-primary"
        >
          <RefreshCw className="h-3 w-3" />
          New Session
        </Button>
      </div>

      {/* Project scope */}
      <div className="border-b border-border bg-bg-surface/50 px-4 py-3 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-3.5 w-3.5 text-accent" />
          <div className="text-[10px] font-mono text-text-muted uppercase tracking-widest">Project Scope</div>
        </div>
        <div className="flex gap-2">
          <Input
            value={projectScope}
            onChange={(e) => setProjectScope(e.target.value)}
            placeholder="/path/to/local/project"
            className="flex-1 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5 shrink-0"
            onClick={() => saveProjectScope(projectScope)}
          >
            <Pin className="h-3 w-3" />
            Pin
          </Button>
        </div>
        {recentScopes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {recentScopes.map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => setProjectScope(scope)}
                className={cn(
                  "px-2 py-1 text-[10px] font-mono rounded border border-border",
                  "text-text-secondary hover:text-accent hover:border-accent/30 hover:bg-accent/5",
                  "transition-colors duration-(--duration-micro)"
                )}
                title={scope}
              >
                {scope.length > 42 ? `${scope.slice(0, 39)}...` : scope}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        {state.messages.length === 0 ? (
          <div className="space-y-4">
            {/* Welcome state */}
            <div className="flex flex-col items-center justify-center py-10 gap-4 px-6">
              {/* Animated swarm logo */}
              <div className="relative h-16 w-16 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-border/40 orbit-ring" style={{ animationDuration: "10s" }} />
                <div className="absolute inset-2 rounded-full border border-accent/20 orbit-ring-ccw" />
                <div className="absolute inset-4 rounded-full border border-border/20" />
                <Bot className="h-5 w-5 text-accent relative z-10" />
              </div>
              <div className="text-center space-y-2">
                <div className="text-sm font-mono font-semibold text-text-primary">
                  SwarmX Composer
                </div>
                <div className="min-h-[1.2rem]">
                  <WelcomeTypewriter />
                </div>
              </div>
            </div>
            <Separator />
            <PresetChips onSelect={sendMessage} />
          </div>
        ) : (
          <div className="py-2">
            {state.messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} msg={msg} />
            ))}
            {state.isLoading && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        {state.messages.length > 0 && (
          <PresetChips onSelect={sendMessage} />
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-2 mt-2">
          <div className="relative flex-1">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your agents, workflows, or system state…"
              className="flex-1 resize-none text-xs pr-4"
              disabled={state.isLoading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
            />
          </div>
          <Button
            type="submit"
            variant="accent"
            size="sm"
            disabled={state.isLoading || !input.trim()}
            className="gap-1.5 shrink-0"
          >
            {state.isLoading ? (
              <>
                <span className="think-dot h-1.5 w-1.5" />
                <span className="think-dot h-1.5 w-1.5" />
                <span className="think-dot h-1.5 w-1.5" />
              </>
            ) : (
              <>
                <Send className="h-3 w-3" />
                Send
              </>
            )}
          </Button>
        </form>
        <p className="text-[9px] font-mono text-text-muted mt-1.5 text-center">
          ↵ Enter · Sessions are ephemeral · Context includes live fleet state
        </p>
      </div>
    </div>
  );
}
