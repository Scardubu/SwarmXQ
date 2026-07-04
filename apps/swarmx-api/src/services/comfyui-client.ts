/**
 * apps/swarmx-api/src/services/comfyui-client.ts
 * VIDEO-ALPHA ComfyUI integration service.
 *
 * Responsibilities:
 * - Submit workflows to /prompt
 * - Poll completion via /history/{prompt_id}
 * - Stream best-effort progress via /ws?clientId=...
 * - Enforce frame RAM budget before submission
 * - Cancel running workflows via /queue endpoint
 */

import { randomUUID } from "node:crypto";
import type { ComfyWorkflow } from "@swarmx/types/video-types";

const DEFAULT_COMFY_BASE_URL = process.env["SWARMX_COMFYUI_URL"] ?? "http://127.0.0.1:8188";
const DEFAULT_MAX_FRAME_BUDGET_MB = parseInt(
  process.env["SWARMX_VIDEO_MAX_FRAME_BUDGET_MB"] ?? "7600",
  10,
);
const DEFAULT_POLL_INTERVAL_MS = parseInt(
  process.env["SWARMX_VIDEO_COMFY_POLL_INTERVAL_MS"] ?? "2000",
  10,
);
const DEFAULT_POLL_MAX_ATTEMPTS = parseInt(
  process.env["SWARMX_VIDEO_COMFY_POLL_MAX_ATTEMPTS"] ?? "180",
  10,
);

export interface ComfyProgress {
  promptId: string;
  pct: number;
  message: string;
}

export interface RunWorkflowResult {
  promptId: string;
  outputFilename: string;
}

export interface ComfyClientOptions {
  baseUrl?: string;
  maxFrameBudgetMb?: number;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
}

export interface RunWorkflowOptions {
  onProgress?: (event: ComfyProgress) => void;
  signal?: AbortSignal;
}

function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, "");
}

function assertFrameBudget(workflow: ComfyWorkflow, maxFrameBudgetMb: number): void {
  if (workflow.ramBudgetMb > maxFrameBudgetMb) {
    throw Object.assign(
      new Error(
        `ComfyUI workflow exceeds frame RAM budget (${workflow.ramBudgetMb}MB > ${maxFrameBudgetMb}MB)`,
      ),
      { code: "FRAME_BUDGET_EXCEEDED" },
    );
  }
}

function toNodeGraphPrompt(workflow: ComfyWorkflow): Record<string, unknown> {
  return workflow.nodeGraph as Record<string, unknown>;
}

function requestInitWithSignal(signal?: AbortSignal): RequestInit {
  return signal ? { signal } : {};
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function extractOutputFilename(
  history: Record<string, { outputs?: Record<string, unknown> }>,
  promptId: string,
): string | null {
  const entry = history[promptId];
  if (!entry?.outputs) return null;

  for (const out of Object.values(entry.outputs)) {
    const candidate = out as { images?: { filename?: string }[]; videos?: { filename?: string }[] };
    const videoName = candidate.videos?.[0]?.filename;
    if (videoName) return videoName;
    const imageName = candidate.images?.[0]?.filename;
    if (imageName) return imageName;
  }

  return null;
}

export class ComfyUIClient {
  private readonly baseUrl: string;
  private readonly maxFrameBudgetMb: number;
  private readonly pollIntervalMs: number;
  private readonly pollMaxAttempts: number;

  constructor(options: ComfyClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_COMFY_BASE_URL);
    this.maxFrameBudgetMb = options.maxFrameBudgetMb ?? DEFAULT_MAX_FRAME_BUDGET_MB;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollMaxAttempts = options.pollMaxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;
  }

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/system_stats`, requestInitWithSignal(signal));
      return res.ok;
    } catch {
      return false;
    }
  }

  async submitWorkflow(workflow: ComfyWorkflow, signal?: AbortSignal): Promise<string> {
    assertFrameBudget(workflow, this.maxFrameBudgetMb);

    const response = await fetch(`${this.baseUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...requestInitWithSignal(signal),
      body: JSON.stringify({ prompt: toNodeGraphPrompt(workflow), client_id: randomUUID() }),
    });

    if (!response.ok) {
      throw Object.assign(new Error(`ComfyUI submit failed: ${response.status}`), {
        code: "COMFY_UNAVAILABLE",
      });
    }

    const payload = (await response.json()) as { prompt_id?: string };
    if (!payload.prompt_id) {
      throw Object.assign(new Error("ComfyUI submit returned no prompt_id"), {
        code: "COMFY_PROTOCOL_ERROR",
      });
    }

    return payload.prompt_id;
  }

  async waitForCompletion(
    promptId: string,
    options: RunWorkflowOptions = {},
  ): Promise<string> {
    for (let attempt = 1; attempt <= this.pollMaxAttempts; attempt += 1) {
      await wait(this.pollIntervalMs, options.signal);

      const response = await fetch(`${this.baseUrl}/history/${promptId}`, {
        ...requestInitWithSignal(options.signal),
      });
      if (!response.ok) continue;

      const history = (await response.json()) as Record<string, { outputs?: Record<string, unknown> }>;
      const maybeFile = extractOutputFilename(history, promptId);
      if (maybeFile) {
        options.onProgress?.({ promptId, pct: 100, message: "render complete" });
        return maybeFile;
      }

      const pct = Math.min(95, Math.round((attempt / this.pollMaxAttempts) * 100));
      options.onProgress?.({ promptId, pct, message: "rendering" });
    }

    throw Object.assign(new Error("ComfyUI history polling timed out"), {
      code: "RENDER_FAILED",
    });
  }

  async cancelWorkflow(promptId: string): Promise<void> {
    // ComfyUI supports deleting queue items by prompt id via /queue.
    // Use best-effort cancellation because some versions may return 404/405.
    await fetch(`${this.baseUrl}/queue`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    }).catch(() => undefined);
  }

  async runWorkflow(
    workflow: ComfyWorkflow,
    options: RunWorkflowOptions = {},
  ): Promise<RunWorkflowResult> {
    const promptId = await this.submitWorkflow(workflow, options.signal);
    const outputFilename = await this.waitForCompletion(promptId, options);
    return { promptId, outputFilename };
  }

  async streamProgress(promptId: string, onProgress: (event: ComfyProgress) => void): Promise<() => void> {
    const clientId = randomUUID();
    const wsUrl = `${this.baseUrl.replace(/^http/, "ws")}/ws?clientId=${clientId}`;

    if (typeof WebSocket === "undefined") {
      return () => undefined;
    }

    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", (ev) => {
      try {
        const payload = JSON.parse(String(ev.data)) as { type?: string; data?: Record<string, unknown> };
        const data = payload.data ?? {};
        if (String(data["prompt_id"] ?? "") !== promptId) return;

        if (payload.type === "progress") {
          const value = Number(data["value"] ?? 0);
          const max = Number(data["max"] ?? 1);
          const pct = max > 0 ? Math.round((value / max) * 100) : 0;
          onProgress({ promptId, pct, message: "rendering" });
        } else if (payload.type === "executing") {
          onProgress({ promptId, pct: 50, message: "executing" });
        }
      } catch {
        // Ignore malformed progress payloads.
      }
    });

    return () => {
      try {
        ws.close();
      } catch {
        // no-op
      }
    };
  }
}

let singleton: ComfyUIClient | null = null;

export function getComfyUIClient(): ComfyUIClient {
  if (!singleton) {
    singleton = new ComfyUIClient();
  }
  return singleton;
}
