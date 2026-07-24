import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dashboard health ETA contract", () => {
  it("does not hardcode cold-start ETA values in the dashboard health/card path", async () => {
    const [healthSource, cardSource] = await Promise.all([
      readFile(new URL("../../src/hooks/useApiHealth.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/components/video/VideoJobCard.tsx", import.meta.url), "utf8"),
    ]);

    expect(healthSource).not.toContain("?? 140");
    expect(cardSource).not.toContain("140");
    expect(cardSource).not.toContain("45");
    expect(cardSource).toContain("ETA unavailable from system health");
  });
});
