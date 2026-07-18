"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Music, Mic, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AudioPlan } from "@swarmx/types/series-types";

interface AudioPlanPanelProps {
  plan: AudioPlan;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-border bg-bg-surface">
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2.5",
          "text-xs font-medium text-text-primary hover:bg-bg-elevated transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          {title}
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 text-text-muted" aria-hidden="true" />
        }
      </button>
      {open && <div className="border-t border-border px-3 py-3">{children}</div>}
    </div>
  );
}

export function AudioPlanPanel({ plan }: AudioPlanPanelProps) {
  return (
    <section aria-label="Audio plan" className="space-y-2">
      {/* Narration style badge */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
          Narration style:
        </span>
        <span className="rounded border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] text-accent capitalize">
          {plan.narrationStyle}
        </span>
      </div>

      <Section title="Music" icon={Music}>
        <p className="text-xs leading-relaxed text-text-secondary">{plan.musicDescription}</p>
      </Section>

      <Section title="Series Sonic Signature" icon={Volume2}>
        <p className="text-xs leading-relaxed text-text-secondary">{plan.seriesSonicSignature}</p>
      </Section>

      {plan.soundEffects.length > 0 && (
        <Section title="Sound Effects" icon={Mic}>
          <ul className="space-y-1">
            {plan.soundEffects.map((sfx, idx) => (
              <li key={idx} className="flex gap-2 text-xs text-text-secondary">
                <span className="shrink-0 text-accent">›</span>
                <span>{sfx}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {plan.silenceCues.length > 0 && (
        <Section title="Silence Cues" icon={Mic}>
          <ul className="space-y-1">
            {plan.silenceCues.map((cue, idx) => (
              <li key={idx} className="flex gap-2 text-xs text-text-secondary">
                <span className="shrink-0 text-text-muted">—</span>
                <span>{cue}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </section>
  );
}
