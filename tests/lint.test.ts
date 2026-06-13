import { describe, it, expect } from "vitest";
import { lint, parseTools, McpLintError } from "../src/core/lint.js";
import type { McpTool } from "../src/core/types.js";

const good: McpTool[] = [
  {
    name: "search_invoices",
    description: "Search invoices by customer or status. Use when the user asks to find or filter invoices.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

describe("parseTools", () => {
  it("accepts a raw array", () => {
    expect(parseTools(good)).toHaveLength(1);
  });
  it("accepts an MCP tools/list envelope", () => {
    expect(parseTools({ tools: good })).toHaveLength(1);
  });
  it("rejects a non-tools payload", () => {
    expect(() => parseTools(42)).toThrow(McpLintError);
  });
  it("rejects a tool with no string name", () => {
    expect(() => parseTools([{ description: "x" }])).toThrow(McpLintError);
  });
});

describe("lint — clean input", () => {
  it("scores a well-formed tool 100 with no findings", () => {
    const r = lint(good);
    expect(r.findings).toHaveLength(0);
    expect(r.score).toBe(100);
    expect(r.estimatedTokens).toBeGreaterThan(0);
  });
  it("treats an empty tool list as clean", () => {
    const r = lint([]);
    expect(r.score).toBe(100);
    expect(r.toolCount).toBe(0);
  });
});

describe("lint — catches real problems", () => {
  it("flags a missing description as an error", () => {
    const r = lint([{ name: "do_thing" }]);
    expect(r.findings.some((f) => f.ruleId === "description-present" && f.severity === "error")).toBe(true);
  });
  it("flags duplicate names", () => {
    const r = lint([
      { name: "dup", description: "a useful description here", inputSchema: { type: "object" } },
      { name: "dup", description: "a useful description here", inputSchema: { type: "object" } },
    ]);
    expect(r.findings.some((f) => f.ruleId === "duplicate-names")).toBe(true);
  });
  it("flags an invalid name", () => {
    const r = lint([{ name: "bad name!", description: "does something useful here", inputSchema: { type: "object" } }]);
    expect(r.findings.some((f) => f.ruleId === "name-format")).toBe(true);
  });
  it("flags a destructive tool with no risk note (underscored name)", () => {
    const r = lint([{ name: "delete_account", description: "Deletes the account.", inputSchema: { type: "object" } }]);
    expect(r.findings.some((f) => f.ruleId === "destructive-safety")).toBe(true);
  });
  it("does NOT flag a destructive tool that documents the risk", () => {
    const r = lint([{ name: "delete_account", description: "Permanently deletes the account. This is irreversible.", inputSchema: { type: "object" } }]);
    expect(r.findings.some((f) => f.ruleId === "destructive-safety")).toBe(false);
  });
  it("flags an over-long description as token bloat", () => {
    const r = lint([{ name: "t", description: "word ".repeat(300), inputSchema: { type: "object" } }]);
    expect(r.findings.some((f) => f.ruleId === "description-length")).toBe(true);
  });
  it("flags a placeholder description", () => {
    const r = lint([{ name: "t", description: "TODO: describe this", inputSchema: { type: "object" } }]);
    expect(r.findings.some((f) => f.ruleId === "description-quality")).toBe(true);
  });
  it("flags a missing input schema", () => {
    const r = lint([{ name: "t", description: "a perfectly fine description" }]);
    expect(r.findings.some((f) => f.ruleId === "input-schema")).toBe(true);
  });
});
