/** Core types for the mcplint engine. Pure data — no I/O lives here. */

export type Severity = "error" | "warning" | "info";

/** Minimal JSON-Schema shape we inspect (MCP input schemas are JSON Schema). */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}

/** A single MCP tool definition, as it appears in a server's tools/list. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  /** The tool the finding relates to, or null for list-level findings. */
  tool: string | null;
  message: string;
}

export interface LintResult {
  findings: Finding[];
  /** 0–100; 100 is clean. */
  score: number;
  toolCount: number;
  counts: Record<Severity, number>;
  /** Rough token cost this server's tool list adds to every request. */
  estimatedTokens: number;
}

/** A rule is a pure function over the whole tool list returning findings. */
export interface Rule {
  id: string;
  severity: Severity;
  title: string;
  check(tools: McpTool[]): Finding[];
}
