"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clapperboard, Sun, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScenePromptSuite, WorldRegistry } from "@swarmx/types/series-types";

interface CinematicDirectionsPanelProps {
  scenes: ScenePromptSuite[];
  worldGuide?: WorldRegistry;
}

function SceneCard({ scene }: { scene: ScenePromptSuite }) {
  const [open, setOpen] = useState(false);
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
        <span className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 font-mono text-[10px] text-text-muted">
            {String(scene.sceneIndex + 1).padStart(2, "0")}
          </span>
          <span className="truncate">{scene.sceneTitle}</span>
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" aria-hidden="true" />
        }
      </button>
      {open && (
        <div className="border-t border-border px-3 py-3">
          <dl className="space-y-2">
            {[
              ["Camera",   scene.camera],
              ["Lighting", scene.lighting],
              ["Motion",   scene.motion],
            ].map(([label, value]) => (
              <div key={label} className="grid grid-cols-[4.5rem,1fr] gap-x-2 text-[11px]">
                <dt className="shrink-0 font-mono text-[10px] text-text-muted pt-px">{label}</dt>
                <dd className="text-text-secondary leading-relaxed">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export function CinematicDirectionsPanel({ scenes, worldGuide }: CinematicDirectionsPanelProps) {
  const grade = worldGuide?.colorGradeContract;
  const grammar = worldGuide?.cinematicShotGrammar;

  return (
    <section aria-label="Cinematic directions" className="space-y-3">
      {/* Series Color Grade */}
      {grade && (
        <div className="rounded border border-border bg-bg-surface px-3 py-3">
          <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            <Sun className="h-3 w-3 text-accent" aria-hidden="true" />
            Series Color Grade
          </p>
          <dl className="grid grid-cols-[max-content,1fr] gap-x-4 gap-y-1 text-[11px]">
            {[
              ["Shadow",      grade.shadowTone],
              ["Highlight",   grade.highlight],
              ["Saturation",  grade.saturation],
              ["Film",        grade.filmEmulation],
            ].map(([label, value]) => (
              <>
                <dt key={`grade-${label}-dt`} className="text-text-muted">{label}</dt>
                <dd key={`grade-${label}-dd`} className="font-mono text-text-secondary">{value}</dd>
              </>
            ))}
          </dl>
        </div>
      )}

      {/* Camera Grammar */}
      {grammar && (
        <div className="rounded border border-border bg-bg-surface px-3 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            <Zap className="h-3 w-3 text-accent" aria-hidden="true" />
            Camera Grammar
          </p>
          <p className="font-mono text-[11px] leading-relaxed text-text-secondary">{grammar}</p>
        </div>
      )}

      {/* Shot List */}
      {scenes.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-muted">
            <Clapperboard className="h-3 w-3 text-accent" aria-hidden="true" />
            Shot List ({scenes.length} {scenes.length === 1 ? "scene" : "scenes"})
          </p>
          <div className="space-y-1.5">
            {scenes.map((scene) => (
              <SceneCard key={scene.sceneIndex} scene={scene} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
