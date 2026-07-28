import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBackend } from "../src/services/backend-fetch-errors.js";
import { isRetryableVideoErrorCode, toVideoJobError } from "../src/services/video-error-classification.js";

describe("backend fetch error classification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps Ollama network failures to OLLAMA_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchBackend("http://127.0.0.1:11434/api/generate", { backend: "ollama" }))
      .rejects.toMatchObject({
        code: "OLLAMA_UNAVAILABLE",
        message: "Ollama unreachable: fetch failed",
      });
  });

  it("maps ComfyUI network failures to COMFY_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(fetchBackend("http://127.0.0.1:8188/prompt", { backend: "comfyui" }))
      .rejects.toMatchObject({
        code: "COMFY_UNAVAILABLE",
        message: "ComfyUI unreachable: fetch failed",
      });
  });

  it("preserves explicit stage timeout abort reasons", async () => {
    const controller = new AbortController();
    controller.abort(Object.assign(new Error("Stage scripting timed out"), { code: "TIMEOUT" }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));

    await expect(fetchBackend("http://127.0.0.1:11434/api/generate", {
      backend: "ollama",
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Stage scripting timed out",
    });
  });

  it("preserves explicit timeout reasons when fetch rejects with signal.reason", async () => {
    const timeout = Object.assign(new Error("Stage intent_classification timed out"), { code: "TIMEOUT" });
    const controller = new AbortController();
    controller.abort(timeout);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    await expect(fetchBackend("http://127.0.0.1:11434/api/generate", {
      backend: "ollama",
      signal: controller.signal,
    })).rejects.toMatchObject({
      code: "TIMEOUT",
      message: "Stage intent_classification timed out",
    });
  });

  it("keeps unexpected protocol and programmer errors non-retryable", () => {
    expect(isRetryableVideoErrorCode("TIMEOUT")).toBe(true);
    expect(isRetryableVideoErrorCode("OLLAMA_UNAVAILABLE")).toBe(true);
    expect(isRetryableVideoErrorCode("COMFY_UNAVAILABLE")).toBe(true);
    expect(toVideoJobError(Object.assign(new Error("bad json"), { code: "COMFY_PROTOCOL_ERROR" })))
      .toMatchObject({ code: "COMFY_PROTOCOL_ERROR", retryable: false });
    expect(toVideoJobError(Object.assign(new Error("bad code"), { code: "NOT_REAL" })))
      .toMatchObject({ code: "UNKNOWN", retryable: false });
  });
});
