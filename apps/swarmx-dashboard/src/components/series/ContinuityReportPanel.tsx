"use client";

import { CheckCircle2, XCircle, ShieldCheck, ShieldAlert, Users, Globe, GitBranch } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { ContinuityReport } from "@swarmx/types/series-types";

interface Props { report: ContinuityReport }

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded border border-border bg-bg-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-1.5"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          <Icon className="h-3 w-3 text-text-muted" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{label}</span>
        </div>
        <span className="text-text-muted text-xs" aria-hidden="true">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function Row({ label, passed, detail }: { label: string; passed: boolean; detail?: string }) {
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      {passed
        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden="true" />
        : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-error" aria-hidden="true" />}
      <div className="min-w-0">
        <p className={cn("text-xs", passed ? "text-text-secondary" : "text-text-primary font-medium")}>{label}</p>
        {detail && <p className="mt-0.5 text-[11px] text-status-error/80">{detail}</p>}
      </div>
    </li>
  );
}

export function ContinuityReportPanel({ report }: Props) {
  const failCount = [
    !report.worldDriftCheck.colorPaletteReferenced,
    !report.worldDriftCheck.soundSignaturePresent,
    !report.worldDriftCheck.locationUsed,
    !report.plotThreadStatus.continuityThreadAddressed,
    !report.plotThreadStatus.chekhovGunPlanted,
    !report.transitionBridgeConfirmed,
    ...report.characterDriftChecks.map((c) => !c.seedPresentInPrompts),
  ].filter(Boolean).length;

  return (
    <section aria-label="Continuity report" className="space-y-3">
      {/* Overall banner */}
      <div
        className={cn(
          "flex items-center gap-2 rounded border px-3 py-2.5",
          report.overallContinuityPassed
            ? "border-status-success/35 bg-status-success/10"
            : "border-status-error/35 bg-status-error/10",
        )}
        role="status"
        aria-live="polite"
      >
        {report.overallContinuityPassed
          ? <ShieldCheck className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
          : <ShieldAlert className="h-4 w-4 shrink-0 text-status-error" aria-hidden="true" />}
        <span className={cn(
          "text-sm font-medium",
          report.overallContinuityPassed ? "text-status-success" : "text-status-error",
        )}>
          {report.overallContinuityPassed
            ? "Continuity verified — no drift detected"
            : `${failCount} continuity issue(s) detected`}
        </span>
      </div>

      <div className="space-y-2">
        {/* Character Drift */}
        <Section icon={Users} label="Character Drift">
          {report.characterDriftChecks.length === 0 ? (
            <p className="px-3 py-2 text-xs text-text-muted">No characters registered — narrator only.</p>
          ) : (
            <ul className="divide-y divide-border">
              {report.characterDriftChecks.map((c) => (
                <li key={c.characterName} className="px-3 py-2">
                  <p className="mb-1 text-xs font-medium text-text-primary">{c.characterName}</p>
                  <ul className="space-y-1">
                    <Row label="AI seed present in scene prompts" passed={c.seedPresentInPrompts} />
                    <Row label="Speaking style noted in dialogue" passed={c.speakingStyleNoted} />
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* World Coherence */}
        <Section icon={Globe} label="World Coherence">
          <ul className="divide-y divide-border">
            <Row label="Color palette referenced in scene prompts" passed={report.worldDriftCheck.colorPaletteReferenced} />
            <Row label="Sound signature present in audio plan" passed={report.worldDriftCheck.soundSignaturePresent} />
            <Row label="Key location used in scene environments" passed={report.worldDriftCheck.locationUsed} />
          </ul>
        </Section>

        {/* Plot Thread Status */}
        <Section icon={GitBranch} label="Plot Thread Status">
          <ul className="divide-y divide-border">
            <Row label="Continuity thread addressed in script" passed={report.plotThreadStatus.continuityThreadAddressed} />
            <Row label="Chekhov's gun planted" passed={report.plotThreadStatus.chekhovGunPlanted} />
            <Row label="Transition bridge specified" passed={report.plotThreadStatus.transitionBridgeSpecified} />
            <Row label="Transition bridge description non-empty" passed={report.transitionBridgeConfirmed} />
          </ul>
        </Section>
      </div>
    </section>
  );
}
