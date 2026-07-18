"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Zap, BookOpen, Flame, Anchor, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EpisodeScript } from "@swarmx/types/series-types";

const SECTIONS = [
  { key: "hook"            as const, label: "Hook",             icon: Zap,       defaultOpen: true  },
  { key: "body"            as const, label: "Body",             icon: BookOpen,  defaultOpen: true  },
  { key: "emotionalPeak"   as const, label: "Emotional Peak",   icon: Flame,     defaultOpen: false },
  { key: "cliffhanger"     as const, label: "Cliffhanger",      icon: Anchor,    defaultOpen: false },
  { key: "transitionBridge"as const, label: "Transition Bridge",icon: ArrowRight,defaultOpen: false },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function ScriptSection({
  label,
  icon: Icon,
  defaultOpen,
  children,
}: {
  label: string;
  icon: React.ElementType;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-border bg-bg-surface">
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2.5",
          "text-sm font-medium text-text-primary hover:bg-bg-elevated transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {label}
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 text-text-muted" aria-hidden="true" />
        }
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          {children}
        </div>
      )}
    </div>
  );
}

interface EpisodeScriptPanelProps {
  script: EpisodeScript;
}

export function EpisodeScriptPanel({ script }: EpisodeScriptPanelProps) {
  const wordCount = script.hook.trim().split(/\s+/).length;
  const hookOverLimit = wordCount > 18;

  return (
    <section aria-label="Episode script" className="space-y-2">
      {SECTIONS.map(({ key, label, icon: Icon, defaultOpen }) => {
        if (key === "hook") {
          return (
            <ScriptSection key={key} label={`${label} (${wordCount} words)`} icon={Icon} defaultOpen={defaultOpen}>
              <p
                className={cn(
                  "text-sm leading-relaxed",
                  hookOverLimit ? "text-status-error" : "text-text-primary",
                )}
              >
                {script.hook}
              </p>
              {hookOverLimit && (
                <p className="mt-1.5 font-mono text-[10px] text-status-error">
                  Hook exceeds 18-word limit — trim before producing
                </p>
              )}
            </ScriptSection>
          );
        }

        if (key === "body") {
          return (
            <ScriptSection key={key} label={label} icon={Icon} defaultOpen={defaultOpen}>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                {script.body}
              </p>
            </ScriptSection>
          );
        }

        if (key === "emotionalPeak") {
          return (
            <ScriptSection key={key} label={label} icon={Icon} defaultOpen={defaultOpen}>
              <p className="text-sm leading-relaxed text-text-secondary">{script.emotionalPeak}</p>
            </ScriptSection>
          );
        }

        if (key === "cliffhanger") {
          return (
            <ScriptSection key={key} label={label} icon={Icon} defaultOpen={defaultOpen}>
              <div className="space-y-1.5">
                <span className="inline-block rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-400">
                  {script.cliffhanger.type}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">{script.cliffhanger.text}</p>
              </div>
            </ScriptSection>
          );
        }

        if (key === "transitionBridge") {
          return (
            <ScriptSection key={key} label={label} icon={Icon} defaultOpen={defaultOpen}>
              <div className="space-y-1.5">
                <span className="inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-text-muted">
                  {script.transitionBridge.type.replace("_", " ")}
                </span>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {script.transitionBridge.description}
                </p>
              </div>
            </ScriptSection>
          );
        }

        return null;
      })}

      <p className="font-mono text-[10px] text-text-muted">
        {script.sceneCount} scene{script.sceneCount !== 1 ? "s" : ""}
      </p>
    </section>
  );
}
