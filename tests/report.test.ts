import { describe, it, expect } from "vitest";
import { toMarkdown, toHtml } from "../src/pro/report.js";
import { lint } from "../src/core/lint.js";
import type { LintResult } from "../src/core/types.js";

const clean: LintResult = lint([
  {
    name: "search_invoices",
    description: "Search invoices by customer or status. Use when the user asks to find or filter invoices.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
]);

// A server with real problems — exercises the findings table in both formats.
const withFindings: LintResult = lint([
  { name: "do_thing" }, // missing description + schema
  { name: "delete_account", description: "Deletes the account." }, // destructive, no risk note + no schema
]);

describe("toMarkdown", () => {
  it("renders the score, tool count and token estimate", () => {
    const md = toMarkdown(clean, "tools.json");
    expect(md).toContain("Score: 100/100");
    expect(md).toContain("1 tools");
    expect(md).toContain("context tokens");
  });

  it("shows the no-issues line for a clean result", () => {
    expect(toMarkdown(clean, "tools.json")).toContain("No issues found.");
  });

  it("renders a findings table and escapes pipes in messages", () => {
    const md = toMarkdown(withFindings, "tools.json");
    expect(md).toContain("| Severity | Tool | Rule | Message |");
    expect(md).toContain("description-present");
  });
});

describe("toHtml", () => {
  it("is a complete standalone HTML document", () => {
    const html = toHtml(clean, "tools.json");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<style>"); // self-contained: styles inlined, no external assets
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("renders the score, tool count and token estimate", () => {
    const html = toHtml(clean, "tools.json");
    expect(html).toContain("100");
    expect(html).toContain("context tokens");
  });

  it("shows the no-issues state for a clean result", () => {
    expect(toHtml(clean, "tools.json")).toContain("No issues found");
  });

  it("renders one table row per finding", () => {
    const html = toHtml(withFindings, "tools.json");
    expect(html).toContain("description-present");
    expect(html).toContain("destructive-safety");
    expect(html).toContain("delete_account");
  });

  it("keeps the honesty disclaimer", () => {
    expect(toHtml(clean, "tools.json")).toContain("not intent");
  });

  // SECURITY (P1): tool names/descriptions/messages are arbitrary third-party
  // JSON — the linter's whole job is parsing untrusted MCP servers. They must be
  // HTML-escaped or the report (which a builder opens in a browser) is an
  // injection vector.
  it("escapes HTML in untrusted tool data so it cannot inject markup", () => {
    const malicious: LintResult = lint([
      { name: "x<script>alert(1)</script>" },
    ]);
    const html = toHtml(malicious, "tools.json");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes HTML in the source label too", () => {
    const html = toHtml(clean, "<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
