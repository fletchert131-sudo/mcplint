/** Parse an MCP tools payload and run the rule set. Pure — no I/O. */
import type { LintResult, McpTool, Severity } from "./types.js";
import { rules } from "./rules.js";
import { estimateTokens, scoreFindings } from "./score.js";

/** Thrown when the input can't be understood as an MCP tools payload. */
export class McpLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpLintError";
  }
}

/** Accepts a raw tools array, or an MCP tools/list envelope `{ tools: [...] }`. */
export function parseTools(input: unknown): McpTool[] {
  const arr = Array.isArray(input)
    ? input
    : isToolsEnvelope(input)
      ? input.tools
      : null;
  if (!arr) {
    throw new McpLintError("Input must be a tools array, or an object with a 'tools' array (an MCP tools/list result).");
  }
  return arr.map(normaliseTool);
}

function isToolsEnvelope(input: unknown): input is { tools: unknown[] } {
  return (
    typeof input === "object" &&
    input !== null &&
    Array.isArray((input as { tools?: unknown }).tools)
  );
}

function normaliseTool(raw: unknown, i: number): McpTool {
  if (!raw || typeof raw !== "object") {
    throw new McpLintError(`Tool at index ${i} is not an object.`);
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.name !== "string") {
    throw new McpLintError(`Tool at index ${i} has no string "name".`);
  }
  return {
    name: o.name,
    description: typeof o.description === "string" ? o.description : undefined,
    inputSchema:
      o.inputSchema && typeof o.inputSchema === "object"
        ? (o.inputSchema as McpTool["inputSchema"])
        : undefined,
  };
}

export function lint(tools: McpTool[]): LintResult {
  const findings = rules.flatMap((r) => r.check(tools));
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return {
    findings,
    score: scoreFindings(findings),
    toolCount: tools.length,
    counts,
    estimatedTokens: estimateTokens(tools),
  };
}
