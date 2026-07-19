"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, User, Globe, Palette, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SeriesJob } from "@swarmx/types/series-types";

interface SeriesContextPanelProps {
  series: SeriesJob;
}

function CollapseSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-border bg-bg-surface">
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between gap-2 px-3 py-2.5",
          "text-sm font-medium text-text-primary",
          "hover:bg-bg-elevated transition-colors duration-(--duration-micro)",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded",
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
          {title}
        </span>
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
          : <ChevronRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
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

const PASS_STATUS_COLOR: Record<string, string> = {
  complete: "bg-status-success",
  running:  "animate-pulse bg-accent",
  failed:   "bg-status-error",
  idle:     "bg-border",
};

export function SeriesContextPanel({ series }: SeriesContextPanelProps) {
  const characters = series.characterBible ?? [];
  const world = series.worldGuide;
  const viralityArc = series.viralityArc;
  const ps = series.planningPassStatus;

  if (characters.length === 0 && !world && !viralityArc && !ps) {
    return (
      <div className="flex items-center gap-2 rounded border border-dashed border-border px-3 py-2.5 text-sm text-text-muted">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-status-reload" aria-hidden="true" />
        Building character bible and world guide…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Planning pass status strip */}
      {ps && (
        <div
          className="flex items-center gap-3 rounded border border-border bg-bg-surface px-3 py-2"
          aria-label="Planning pass status"
        >
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            Passes
          </span>
          <div className="flex items-center gap-3">
            {(["pass1", "pass2", "pass3", "pass4"] as const).map((key, i) => (
              <span key={key} className="flex items-center gap-1" aria-label={`Pass ${i + 1}: ${ps[key]}`}>
                <span
                  className={cn("h-2 w-2 rounded-full", PASS_STATUS_COLOR[ps[key]] ?? "bg-border")}
                  aria-hidden="true"
                />
                <span className="font-mono text-[10px] text-text-muted">{i + 1}</span>
              </span>
            ))}
          </div>
          <span className="ml-auto font-mono text-[10px] text-text-muted capitalize">
            {series.status}
          </span>
        </div>
      )}
      {/* Character Bible */}
      {characters.length > 0 && (
        <CollapseSection title={`Character Bible (${characters.length})`} icon={User} defaultOpen>
          <div className="space-y-4">
            {characters.map((char) => (
              <div key={char.name} className="space-y-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
                <p className="font-medium text-text-primary text-sm">{char.name}</p>
                <dl className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1 text-[11px]">
                  {[
                    ["Appearance", char.appearance],
                    ["Outfit", char.defaultOutfit],
                    ["Personality", char.personality],
                    ["Arc", char.emotionalArc],
                    ["Cues", char.signatureCues],
                  ].map(([label, value]) => (
                    <>
                      <dt key={`${char.name}-${label}-dt`} className="text-text-muted">{label}</dt>
                      <dd key={`${char.name}-${label}-dd`} className="text-text-secondary">{value}</dd>
                    </>
                  ))}
                </dl>
                {char.aiPromptSeed && (
                  <div className="mt-1.5 rounded border border-border-accent bg-[var(--color-accent-dim)] px-2 py-1.5">
                    <p className="text-[10px] font-mono text-accent/80">AI Seed: {char.aiPromptSeed}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CollapseSection>
      )}

      {/* World Guide */}
      {world && (
        <CollapseSection title="World Guide" icon={Globe}>
          <dl className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1.5 text-[11px]">
            {[
              ["Architecture", world.architecture],
              ["Era", world.era],
              ["Camera", `${world.cameraLanguage.defaultLens} · ${world.cameraLanguage.defaultMovementStyle}`],
              ["Shot rules", world.cameraLanguage.shotGrammarRules],
              ["Sound", world.soundSignature],
            ].map(([label, value]) => (
              <>
                <dt key={`world-${label}-dt`} className="text-text-muted">{label}</dt>
                <dd key={`world-${label}-dd`} className="text-text-secondary">{value}</dd>
              </>
            ))}
            {world.visualMotifs.length > 0 && (
              <>
                <dt className="text-text-muted">Motifs</dt>
                <dd className="text-text-secondary">{world.visualMotifs.join(" · ")}</dd>
              </>
            )}
          </dl>
          {world.colorPalette.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <Palette className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
              <div className="flex gap-1.5">
                {world.colorPalette.map((color) => (
                  <span
                    key={color}
                    className="h-5 w-5 rounded border border-border shadow-sm"
                    style={{ backgroundColor: color }}
                    title={color}
                    aria-label={`Color: ${color}`}
                  />
                ))}
              </div>
              <span className="text-[10px] text-text-muted font-mono">
                {world.colorPalette.join(" · ")}
              </span>
            </div>
          )}
          {/* Color Grade Contract (Pass 4 cinematic lock — optional) */}
          {world.colorGradeContract && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Color Grade</p>
              <dl className="grid grid-cols-[max-content,1fr] gap-x-3 gap-y-1 text-[11px]">
                {([
                  ["Shadow",     world.colorGradeContract.shadowTone],
                  ["Highlight",  world.colorGradeContract.highlight],
                  ["Saturation", world.colorGradeContract.saturation],
                  ["Film",       world.colorGradeContract.filmEmulation],
                ] as const).map(([label, value]) => (
                  <>
                    <dt key={`grade-${label}-dt`} className="text-text-muted">{label}</dt>
                    <dd key={`grade-${label}-dd`} className="font-mono text-text-secondary">{value}</dd>
                  </>
                ))}
              </dl>
            </div>
          )}

          {/* Cinematic Shot Grammar (Pass 4 cinematic lock — optional) */}
          {world.cinematicShotGrammar && (
            <div className="mt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Shot Grammar</p>
              <p className="mt-1 font-mono text-[11px] leading-relaxed text-text-secondary">
                {world.cinematicShotGrammar}
              </p>
            </div>
          )}

          {world.keyLocations.length > 0 && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-wide text-text-muted">Key Locations</p>
              {world.keyLocations.map((loc) => (
                <div key={loc.name} className="text-[11px]">
                  <span className="font-medium text-text-secondary">{loc.name}</span>
                  <span className="text-text-muted"> — {loc.description}</span>
                </div>
              ))}
            </div>
          )}
        </CollapseSection>
      )}

      {/* Virality Arc — structured (V6.2.30+) or prose fallback */}
      {(series.viralityArcData ?? viralityArc) && (
        <CollapseSection title="Virality Arc" icon={TrendingUp}>
          {series.viralityArcData ? (
            <dl className="space-y-2.5">
              {([
                ["Curiosity Gap",    series.viralityArcData.curiosityGap],
                ["Micro-reward",     series.viralityArcData.microRewardCadence],
                ["Loyalty Signal",   series.viralityArcData.loyaltySignal],
                ["Social Hook",      series.viralityArcData.socialProofHook],
                ["Loop Ending",      series.viralityArcData.loopEnding],
                ["Algorithm Signal", series.viralityArcData.algorithmSignal],
                ["Recency Loop",     series.viralityArcData.recencyLoop],
              ] as const).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[7rem,1fr] gap-x-3 text-[11px]">
                  <dt className="shrink-0 text-text-muted pt-px">{label}</dt>
                  <dd className="text-text-secondary leading-relaxed">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[11px] leading-relaxed text-text-secondary">{viralityArc}</p>
          )}
        </CollapseSection>
      )}
    </div>
  );
}
