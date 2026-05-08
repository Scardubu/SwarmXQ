"use client";

import { useEffect } from "react";
import { useUIStore } from "@/stores/ui";
import { useRouter } from "next/navigation";

type KeyHandler = (e: KeyboardEvent) => void;
type UIStoreState = ReturnType<typeof useUIStore.getState>;

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const modKey = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

const NAVIGATION_SHORTCUTS: Record<string, string> = {
  "1": "/",
  "2": "/composer",
  "3": "/agents",
  "4": "/workflows",
  "5": "/logs",
  "6": "/system",
};

function handleCommandPaletteShortcut(
  event: KeyboardEvent,
  openCommandPalette: () => void
): boolean {
  if (event.key.toLowerCase() !== "k" || isTerminalFocused()) {
    return false;
  }

  openCommandPalette();
  return true;
}

function handleToggleShortcut(
  event: KeyboardEvent,
  actions: {
    toggleNav: () => void;
    toggleTerminal: () => void;
    toggleTerminalFullscreen: () => void;
    toggleTelemetryRail: () => void;
    addTerminalTab: UIStoreState["addTerminalTab"];
  }
): boolean {
  const key = event.key;
  const keyLower = key.toLowerCase();

  if (keyLower === "b") {
    actions.toggleNav();
    return true;
  }

  if (key === "`") {
    return handleTerminalShortcut(event.shiftKey, actions);
  }

  return handleTShortcut(event, key, keyLower, actions);
}

function handleTerminalShortcut(
  isFullscreen: boolean,
  actions: {
    toggleTerminal: () => void;
    toggleTerminalFullscreen: () => void;
  }
): boolean {
  if (isFullscreen) {
    actions.toggleTerminalFullscreen();
  } else {
    actions.toggleTerminal();
  }

  return true;
}

function handleTShortcut(
  event: KeyboardEvent,
  key: string,
  keyLower: string,
  actions: {
    toggleTelemetryRail: () => void;
    addTerminalTab: UIStoreState["addTerminalTab"];
  }
): boolean {
  if (keyLower === "t" && !event.shiftKey) {
    actions.addTerminalTab();
    return true;
  }

  if (key === "T" && event.shiftKey) {
    actions.toggleTelemetryRail();
    return true;
  }

  return false;
}

function handleNavigationShortcut(event: KeyboardEvent, navigate: (path: string) => void): boolean {
  if (event.shiftKey || event.altKey) {
    return false;
  }

  const target = NAVIGATION_SHORTCUTS[event.key];
  if (!target) {
    return false;
  }

  navigate(target);
  return true;
}

/**
 * Global keyboard shortcut handler.
 * Mount once at the dashboard layout root.
 */
export function useKeyboard(): void {
  const toggleNav = useUIStore((s: UIStoreState) => s.toggleNav);
  const toggleTerminal = useUIStore((s: UIStoreState) => s.toggleTerminal);
  const toggleTerminalFullscreen = useUIStore((s: UIStoreState) => s.toggleTerminalFullscreen);
  const openCommandPalette = useUIStore((s: UIStoreState) => s.openCommandPalette);
  const toggleTelemetryRail = useUIStore((s: UIStoreState) => s.toggleTelemetryRail);
  const addTerminalTab = useUIStore((s: UIStoreState) => s.addTerminalTab);
  const router = useRouter();

  useEffect(() => {
    const executeShortcut = (e: KeyboardEvent): boolean => {
      if (!modKey(e)) return false;

      if (handleCommandPaletteShortcut(e, openCommandPalette)) {
        return true;
      }

      if (
        handleToggleShortcut(e, {
          toggleNav,
          toggleTerminal,
          toggleTerminalFullscreen,
          toggleTelemetryRail,
          addTerminalTab,
        })
      ) {
        return true;
      }

      return handleNavigationShortcut(e, (path) => router.push(path));
    };

    const handler: KeyHandler = (e) => {
      if (executeShortcut(e)) {
        e.preventDefault();
      }
    };

    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [toggleNav, toggleTerminal, toggleTerminalFullscreen, openCommandPalette, toggleTelemetryRail, addTerminalTab, router]);
}

function isTerminalFocused(): boolean {
  const el = document.activeElement;
  return el?.closest("[data-terminal-instance]") != null;
}
