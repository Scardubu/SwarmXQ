"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useEventsStore } from "@/stores/events";
import { useUIStore } from "@/stores/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Send, Bot, Sparkles, RefreshCw, FolderOpen, Pin } from "lucide-react";

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

// [V5.9-FIX-08] If Next.js rewrite proxy returns 5xx (for example while API is
// restarting), retry against explicit API origin to avoid hard user-visible 500.
function resolveDirectApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SWARMX_API_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return "http://127.0.0.1:3001";
}

const COMPOSER_RECENT_SCOPES_KEY = "swarmx:composer:recent-scopes";
const DEFAULT_PROJECT_SCOPE =
  process.env.NEXT_PUBLIC_SWARMX_PROJECT_PATH ?? "/home/scar/Downloads/SwarmX-1.5";

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { readonly msg: ComposerMessage }) {
  const isUser = msg.role === "user";
  const time = new Date(msg.timestamp).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });

  return (
    <div className={cn("flex gap-3 px-4 py-3", isUser ? "flex-row-reverse" : "flex-row")}>
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

// ── Agent suggestion chips ────────────────────────────────────────────────────

const PRESET_PROMPTS = [
  "List all running agents and their current tasks",
  "Show me agents with high CPU usage (>80%)",
  "What workflows have run in the last hour?",
  "Show OOM events in the swarmx.slice cgroup",
  "Find agents in error state and describe their last error",
  "Summarize the current queue depth across all queues",
] as const;

function PresetPrompts({ onSelect }: { readonly onSelect: (p: string) => void }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[9px] font-mono text-text-muted uppercase tracking-widest mb-2">
        Quick queries
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className={cn(
              "px-2 py-1 text-[10px] font-mono rounded border border-border",
              "text-text-secondary hover:text-text-primary hover:border-border-active",
              "transition-colors duration-(--duration-micro)"
            )}
          >
            {p.length > 40 ? p.slice(0, 37) + "…" : p}
          </button>
        ))}
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
        setRecentScopes(parsed.filter((value) => typeof value === "string" && value.length > 0).slice(0, 5));
      }
    } catch {
      // Ignore malformed local storage.
    }
  }, []);

  // Scroll to bottom on new messages
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
      } catch {
        // Storage failure is non-fatal.
      }
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

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      isLoading: true,
    }));
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
            content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
            timestamp: Date.now(),
          },
        ],
        isLoading: false,
      }));
    }
  }, [state.sessionId, state.isLoading, agents]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h1 className="text-sm font-mono font-semibold text-text-primary">AI Composer</h1>
          <span className="text-[10px] font-mono text-text-muted">
            {[...agents.values()].filter((a) => a.status === "running").length} agents available
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            setState({ messages: [], isLoading: false, sessionId: "composer-main" })
          }
          className="gap-1.5"
        >
          <RefreshCw className="h-3 w-3" />
          New Session
        </Button>
      </div>

      <div className="border-b border-border bg-bg-surface/50 px-4 py-3 space-y-2">
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
            className="gap-1.5"
            onClick={() => saveProjectScope(projectScope)}
          >
            <Pin className="h-3 w-3" />
            Save
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
                  "text-text-secondary hover:text-text-primary hover:border-border-active",
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
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Bot className="h-10 w-10 text-text-muted" />
              <div className="text-center">
                <div className="text-sm font-mono text-text-secondary">SwarmX Composer</div>
                <div className="text-xs font-mono text-text-muted mt-1">
                  Query and direct your agent fleet with natural language
                </div>
              </div>
            </div>
            <Separator />
            <PresetPrompts onSelect={sendMessage} />
          </div>
        ) : (
          <div className="py-2">
            {state.messages.map((msg, i) => (
              <MessageBubble key={`${msg.timestamp}-${i}`} msg={msg} />
            ))}
            {state.isLoading && (
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="h-6 w-6 rounded-full bg-(--color-accent-dim) flex items-center justify-center">
                  <Bot className="h-3 w-3 text-text-secondary" />
                </div>
                <div className="flex items-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce"
                      style={{ animationDelay: `${i * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="px-4 py-3 border-t border-border shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your agents, workflows, or system state…"
            className="flex-1 resize-none text-xs"
            disabled={state.isLoading}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
          />
          <Button
            type="submit"
            variant="accent"
            size="sm"
            disabled={state.isLoading || !input.trim()}
            className="gap-1.5 shrink-0"
          >
            <Send className="h-3 w-3" />
            Send
          </Button>
        </form>
        <p className="text-[9px] font-mono text-text-muted mt-1.5 text-center">
          ↵ Enter to send · SwarmX sessions are ephemeral
        </p>
      </div>
    </div>
  );
}
