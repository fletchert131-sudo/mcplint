/** Scoring: turn findings into a 0–100 score, and estimate context cost. Pure. */
import type { Finding, McpTool, Severity } from "./types.js";

/** Penalty per finding by severity. Errors dominate; info is a gentle nudge. */
export const WEIGHT: Record<Severity, number> = { error: 12, warning: 4, info: 1 };

export function scoreFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + WEIGHT[f.severity], 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Rough token estimate (~4 chars/token) of the serialised tool list — the
 * weight this server adds to every request's context window. A real number
 * builders can act on, not a vibe. */
export function estimateTokens(tools: McpTool[]): number {
  return Math.ceil(JSON.stringify(tools).length / 4);
}
