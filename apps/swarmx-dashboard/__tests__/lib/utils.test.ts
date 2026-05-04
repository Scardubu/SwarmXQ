import { describe, it, expect } from "vitest";
import { cn, formatBytes, formatBps, formatPct, resourceColor } from "@/lib/utils";

const disabledClass = 0;

describe("cn", () => {
  it("merges class strings", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("resolves Tailwind conflicts", () => {
    // tailwind-merge should keep the last padding
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("handles falsy values", () => {
    expect(cn("a", disabledClass && "b", undefined, null, "c")).toBe("a c");
  });
});

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("formats megabytes with default 1 decimal", () => {
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
  });

  it("caps at TB", () => {
    expect(formatBytes(1024 ** 4)).toBe("1 TB");
  });
});

describe("formatBps", () => {
  it("appends /s suffix", () => {
    expect(formatBps(1024)).toBe("1 KB/s");
  });
});

describe("formatPct", () => {
  it("formats percentage", () => {
    expect(formatPct(75.567)).toBe("75.6%");
  });

  it("respects custom decimals", () => {
    expect(formatPct(50, 0)).toBe("50%");
  });
});

describe("resourceColor", () => {
  it("returns safe color below 60%", () => {
    expect(resourceColor(0)).toBe("var(--color-resource-safe)");
    expect(resourceColor(59)).toBe("var(--color-resource-safe)");
  });

  it("returns warn color 60-84%", () => {
    expect(resourceColor(60)).toBe("var(--color-resource-warn)");
    expect(resourceColor(84)).toBe("var(--color-resource-warn)");
  });

  it("returns critical color at 85%+", () => {
    expect(resourceColor(85)).toBe("var(--color-resource-critical)");
    expect(resourceColor(100)).toBe("var(--color-resource-critical)");
  });
});
