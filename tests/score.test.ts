import { describe, it, expect } from "vitest";
import { scoreFindings, estimateTokens, WEIGHT } from "../src/core/score.js";
import type { Finding } from "../src/core/types.js";

const f = (severity: Finding["severity"]): Finding => ({ ruleId: "x", severity, tool: null, message: "" });

describe("scoreFindings", () => {
  it("is 100 with no findings", () => {
    expect(scoreFindings([])).toBe(100);
  });
  it("subtracts weighted penalties", () => {
    expect(scoreFindings([f("error"), f("warning"), f("info")])).toBe(100 - WEIGHT.error - WEIGHT.warning - WEIGHT.info);
  });
  it("never goes below 0", () => {
    expect(scoreFindings(Array.from({ length: 50 }, () => f("error")))).toBe(0);
  });
});

describe("estimateTokens", () => {
  it("grows with payload size", () => {
    const small = estimateTokens([{ name: "a" }]);
    const big = estimateTokens([{ name: "a", description: "x".repeat(400) }]);
    expect(big).toBeGreaterThan(small);
  });
});
