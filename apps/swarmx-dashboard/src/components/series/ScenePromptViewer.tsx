"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScenePromptSuite } from "@swarmx/types/series-types";

const PROMPT_FIELDS: Array<{ key: keyof Omit<ScenePromptSuite, "sceneIndex" | "sceneTitle">; label: string }> = [
  { key: "master",      label: "① Master" },
  { key: "character",   label: "② Character" },
  { key: "environment", label: "③ Environment" },
  { key: "camera",      label: "④ Camera" },
  { key: "lighting",    label: "⑤ Lighting" },
  { key: "motion",      label: "⑥ Motion" },
  { key: "style",       label: "⑦ Style" },
  { key: "animation",   label: "⑧ Animation" },
  { key: "negative",    label: "⑨ Negative" },
];

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
        <span className="flex items-center gap-2">
          <Camera className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
          <span className="font-mono text-text-muted text-[10px]">Scene {scene.sceneIndex + 1}</span>
          <span className="text-text-primary">{scene.sceneTitle}</span>
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 text-text-muted" aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 text-text-muted" aria-hidden="true" />
        }
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {PROMPT_FIELDS.map(({ key, label }) => (
            <div key={key} className="px-3 py-2.5">
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                {label}
              </p>
              <p
                className={cn(
                  "text-xs leading-relaxed text-text-secondary",
                  key === "negative" && "text-text-muted",
                )}
              >
                {scene[key]}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ScenePromptViewerProps {
  scenes: ScenePromptSuite[];
}

export function ScenePromptViewer({ scenes }: ScenePromptViewerProps) {
  return (
    <section aria-label="Scene AI prompt suites" className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
        {scenes.length} scene{scenes.length !== 1 ? "s" : ""} · 9 prompt types each
      </p>
      {scenes.map((scene) => (
        <SceneCard key={scene.sceneIndex} scene={scene} />
      ))}
    </section>
  );
}
