import { describe, expect, it } from "vitest";
import { getRuntimeGuidance } from "@/lib/runtime-guidance";

describe("getRuntimeGuidance", () => {
  it("returns no notice for an available, unconstrained runtime", () => {
    expect(
      getRuntimeGuidance({
        apiOnline: true,
        ollamaOnline: true,
        pressureLevel: "normal",
        availableMb: 2_400,
      }),
    ).toBeNull();
  });

  it("prioritizes API recovery over an unknown backend state", () => {
    const guidance = getRuntimeGuidance({
      apiOnline: false,
      ollamaOnline: null,
      pressureLevel: "normal",
      availableMb: 2_400,
    });

    expect(guidance).toMatchObject({
      tone: "critical",
      title: "SwarmX API unavailable",
    });
    expect(guidance?.recoveryHint).toContain("port 3001");
  });

  it("distinguishes Ollama loss while retaining memory context", () => {
    const guidance = getRuntimeGuidance({
      apiOnline: true,
      ollamaOnline: false,
      pressureLevel: "high",
      availableMb: 879,
    });

    expect(guidance).toMatchObject({
      tone: "warning",
      title: "Ollama backend unavailable",
    });
    expect(guidance?.detail).toContain("Memory pressure is also high (879 MB free)");
    expect(guidance?.recoveryHint).toContain("ollama serve");
  });

  it("reports high and critical memory states with distinct severity", () => {
    expect(
      getRuntimeGuidance({
        apiOnline: true,
        ollamaOnline: true,
        pressureLevel: "high",
        availableMb: 1_150,
      }),
    ).toMatchObject({ tone: "warning", title: "Memory pressure high (1,150 MB free)" });

    expect(
      getRuntimeGuidance({
        apiOnline: true,
        ollamaOnline: true,
        pressureLevel: "critical",
        availableMb: 879,
      }),
    ).toMatchObject({ tone: "critical", title: "Memory pressure critical (879 MB free)" });
  });
});