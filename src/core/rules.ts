/** The mcplint rule set. Each rule is a pure function over the tool list.
 * These encode MCP-specific quality knowledge a generic JSON/schema linter
 * lacks: description usefulness, token weight, and safety on destructive tools. */
import type { Finding, McpTool, Rule, Severity } from "./types.js";

const MAX_NAME = 128; // MCP/Anthropic tool-name length cap
const MIN_DESC = 12; // chars; below this a description can't guide tool choice
const MAX_DESC = 1024; // chars; above this it bloats every request's context
/** The MCP / Anthropic tool-name charset: letters, digits, underscore, hyphen.
 *  Hyphenated kebab-case (`get-sum`) is valid and widely used across the real
 *  ecosystem (the official server-everything, GitHub's MCP server, …), so it
 *  must NOT be an error — flagging it would score spec-compliant servers 0/100.
 *  A leading digit is permitted by the charset; we don't reject it. */
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const PLACEHOLDER = /\b(todo|tbd|fixme|describe this|tool description|lorem ipsum|placeholder)\b/i;

/** Verbs that imply a destructive/irreversible action (matched per name token,
 * because names are underscore/camel-joined, so word boundaries don't apply). */
const DESTRUCTIVE = new Set([
  "delete", "drop", "remove", "destroy", "truncate", "wipe", "purge",
  "overwrite", "reset", "exec", "execute", "kill",
]);
const RISK_NOTED = /\b(irreversible|cannot be undone|permanent(ly)?|destructive|caution|careful|confirm)\b/i;

function nameTokens(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function finding(ruleId: string, severity: Severity, tool: string | null, message: string): Finding {
  return { ruleId, severity, tool, message };
}

export const rules: Rule[] = [
  {
    id: "name-format",
    severity: "error",
    title: "Tool names must be valid identifiers",
    check: (tools) =>
      tools
        .filter((t) => !NAME_RE.test(t.name) || t.name.length > MAX_NAME)
        .map((t) =>
          finding("name-format", "error", t.name,
            `Name ${JSON.stringify(t.name)} must match [A-Za-z0-9_-]+ and be ≤ ${MAX_NAME} chars.`)),
  },
  {
    id: "duplicate-names",
    severity: "error",
    title: "Tool names must be unique",
    check: (tools) => {
      const counts = new Map<string, number>();
      for (const t of tools) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
      return [...counts.entries()]
        .filter(([, n]) => n > 1)
        .map(([name, n]) => finding("duplicate-names", "error", name, `Name "${name}" is defined ${n}× — names must be unique within a server.`));
    },
  },
  {
    id: "description-present",
    severity: "error",
    title: "Every tool needs a description",
    check: (tools) =>
      tools
        .filter((t) => !t.description || t.description.trim().length === 0)
        .map((t) => finding("description-present", "error", t.name, "Missing description — the model can't choose a tool it can't understand.")),
  },
  {
    id: "description-length",
    severity: "warning",
    title: "Descriptions should be informative but not bloated",
    check: (tools) =>
      tools.flatMap((t) => {
        const d = t.description?.trim() ?? "";
        if (d.length === 0) return []; // handled by description-present
        if (d.length < MIN_DESC) return [finding("description-length", "warning", t.name, `Description is only ${d.length} chars; state what it does and when to use it.`)];
        if (d.length > MAX_DESC) return [finding("description-length", "warning", t.name, `Description is ${d.length} chars; over ${MAX_DESC} it bloats every request. Trim, or move detail behind the call.`)];
        return [];
      }),
  },
  {
    id: "description-quality",
    severity: "warning",
    title: "Descriptions should be real, not placeholders",
    check: (tools) =>
      tools
        .filter((t) => t.description !== undefined && PLACEHOLDER.test(t.description))
        .map((t) => finding("description-quality", "warning", t.name, "Description looks like a placeholder — replace with real guidance on when to use the tool.")),
  },
  {
    id: "input-schema",
    severity: "warning",
    title: "Tools should declare an object input schema",
    check: (tools) =>
      tools.flatMap((t) => {
        const s = t.inputSchema;
        if (!s) return [finding("input-schema", "warning", t.name, "No inputSchema — declare one (type: object) so the model sends well-formed arguments.")];
        if (s.type !== "object") return [finding("input-schema", "info", t.name, `inputSchema.type is ${JSON.stringify(s.type)}; MCP tool inputs are conventionally objects.`)];
        return [];
      }),
  },
  {
    id: "required-documented",
    severity: "warning",
    title: "Required params must exist in properties",
    check: (tools) =>
      tools.flatMap((t) => {
        const s = t.inputSchema;
        if (!s?.required || !s.properties) return [];
        const props = s.properties;
        return s.required
          .filter((r) => !(r in props))
          .map((r) => finding("required-documented", "warning", t.name, `Required param "${r}" is not defined in properties.`));
      }),
  },
  {
    id: "destructive-safety",
    severity: "warning",
    title: "Destructive tools should signal their risk",
    check: (tools) =>
      tools
        .filter((t) => {
          const isDestructive = nameTokens(t.name).some((tok) => DESTRUCTIVE.has(tok));
          const documented = t.description !== undefined && RISK_NOTED.test(t.description);
          return isDestructive && !documented;
        })
        .map((t) => finding("destructive-safety", "warning", t.name, "Name implies a destructive action but the description doesn't flag the risk — say if it's irreversible or needs confirmation.")),
  },
];
