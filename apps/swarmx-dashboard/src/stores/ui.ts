"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { TerminalTab } from "@swarmx/types";
import { generateSessionId } from "@/lib/utils";

interface UIState {
  // Nav rail
  navExpanded: boolean;
  // Terminal strip
  terminalVisible: boolean;
  terminalFullscreen: boolean;
  terminalTabs: TerminalTab[];
  activeTerminalTabId: string | null;
  // Command palette
  commandPaletteOpen: boolean;
  // Telemetry rail
  telemetryRailVisible: boolean;
}

interface UIActions {
  toggleNav: () => void;
  setNavExpanded: (expanded: boolean) => void;
  toggleTerminal: () => void;
  toggleTerminalFullscreen: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleTelemetryRail: () => void;
  // Terminal tabs
  addTerminalTab: (label?: string, agentId?: string) => TerminalTab;
  removeTerminalTab: (id: string) => void;
  setActiveTerminalTab: (id: string) => void;
  updateTerminalTab: (id: string, patch: Partial<Omit<TerminalTab, "id">>) => void;
}

const DEFAULT_TAB: TerminalTab = {
  id: "main",
  label: "Main",
  sessionId: generateSessionId(),
  lastExitCode: null,
  cwd: "~",
  createdAt: Date.now(),
};

export const useUIStore = create<UIState & UIActions>()(
  subscribeWithSelector((set, get) => ({
    navExpanded: false,
    terminalVisible: true,
    terminalFullscreen: false,
    terminalTabs: [DEFAULT_TAB],
    activeTerminalTabId: DEFAULT_TAB.id,
    commandPaletteOpen: false,
    telemetryRailVisible: true,

    toggleNav: () => set((s) => ({ navExpanded: !s.navExpanded })),
    setNavExpanded: (expanded) => set({ navExpanded: expanded }),

    toggleTerminal: () =>
      set((s) => ({
        terminalVisible: !s.terminalVisible,
        terminalFullscreen: s.terminalVisible ? false : s.terminalFullscreen,
      })),

    toggleTerminalFullscreen: () =>
      set((s) => ({
        terminalFullscreen: !s.terminalFullscreen,
        terminalVisible: true,
      })),

    openCommandPalette: () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),

    toggleTelemetryRail: () =>
      set((s) => ({ telemetryRailVisible: !s.telemetryRailVisible })),

    addTerminalTab: (label?, agentId?) => {
      const tab: TerminalTab = {
        id: `tab-${Date.now()}`,
        label: label ?? "Terminal",
        sessionId: generateSessionId(),
        ...(agentId !== undefined && { agentId }),
        lastExitCode: null,
        cwd: "~",
        createdAt: Date.now(),
      };
      set((s) => ({
        terminalTabs: [...s.terminalTabs, tab],
        activeTerminalTabId: tab.id,
        terminalVisible: true,
      }));
      return tab;
    },

    removeTerminalTab: (id) => {
      const { terminalTabs, activeTerminalTabId } = get();
      if (terminalTabs.length <= 1) return; // Keep at least one tab
      const filtered = terminalTabs.filter((t) => t.id !== id);
      const newActive =
        activeTerminalTabId === id
          ? (filtered[filtered.length - 1]?.id ?? null)
          : activeTerminalTabId;
      set({ terminalTabs: filtered, activeTerminalTabId: newActive });
    },

    setActiveTerminalTab: (id) => set({ activeTerminalTabId: id }),

    updateTerminalTab: (id, patch) =>
      set((s) => ({
        terminalTabs: s.terminalTabs.map((t) =>
          t.id === id ? { ...t, ...patch } : t
        ),
      })),
  }))
);
