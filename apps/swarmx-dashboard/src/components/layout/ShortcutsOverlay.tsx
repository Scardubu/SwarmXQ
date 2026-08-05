"use client";

import { useEffect, useRef } from "react";
import { Keyboard, X } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

const SHORTCUT_GROUPS = [
  {
    label: "Navigation",
    items: [
      { keys: "⌘1", action: "Overview" },
      { keys: "⌘2", action: "Composer" },
      { keys: "⌘3", action: "Agent Fleet" },
      { keys: "⌘4", action: "Workflows" },
      { keys: "⌘5", action: "Logs" },
      { keys: "⌘6", action: "System" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { keys: "⌘K", action: "Command palette" },
      { keys: "⌘B", action: "Sidebar" },
      { keys: "⌘⇧T", action: "Telemetry panel" },
      { keys: "⌘⇧O", action: "Operator disclosure" },
      { keys: "?", action: "Shortcuts" },
    ],
  },
  {
    label: "Terminal",
    items: [
      { keys: "⌘`", action: "Terminal" },
      { keys: "⌘T", action: "New tab" },
      { keys: "⌘⇧`", action: "Fullscreen terminal" },
    ],
  },
  {
    label: "Video Queue",
    items: [
      { keys: "Tab", action: "Move through controls" },
      { keys: "Enter", action: "Open focused job" },
      { keys: "Move Up/Down", action: "Reorder queued jobs" },
    ],
  },
] as const;

export function ShortcutsOverlay() {
  const isOpen = useUIStore((s) => s.shortcutsOpen);
  const close = useUIStore((s) => s.closeShortcuts);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-100 flex items-start justify-center bg-transparent pt-[14vh]"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        aria-label="Close shortcuts"
        onClick={close}
      />
      <div
        className={cn(
          "relative mx-4 w-full max-w-2xl overflow-hidden rounded border border-border-active bg-bg-elevated",
          "shadow-[0_24px_48px_rgba(0,0,0,0.6)]",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-accent" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h2>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            aria-label="Close shortcuts"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="grid gap-0 divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.label} className="p-4">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-text-muted">{group.label}</h3>
              <dl className="space-y-2">
                {group.items.map((item) => (
                  <div key={`${group.label}-${item.keys}`} className="flex items-center justify-between gap-3">
                    <dt className="text-xs text-text-secondary">{item.action}</dt>
                    <dd className="shrink-0 rounded border border-border bg-bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                      {item.keys}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </dialog>
  );
}
