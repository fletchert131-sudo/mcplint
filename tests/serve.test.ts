import { describe, it, expect } from "vitest";
import { handleRequest, LINT_TOOLS_TOOL } from "../src/serve/server.js";
import { lint, parseTools } from "../src/core/lint.js";
import type { LintResult } from "../src/core/types.js";

/** Drive the pure JSON-RPC handler directly — no process, no stdio, no network.
 *  This exercises the same code path the stdio runtime feeds frame-by-frame. */

const GOOD_TOOLS = [
  {
    name: "search_invoices",
    description: "Search invoices by customer or status. Use when the user asks to find or filter invoices.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

describe("mcplint MCP server — handshake", () => {
  it("answers initialize with server info and tools capability", () => {
    const reply = handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(reply).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "mcplint" }, capabilities: { tools: {} } },
    });
  });

  it("echoes the client's requested protocolVersion when given one", () => {
    const reply = handleRequest({
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05" },
    }) as { result: { protocolVersion: string } };
    expect(reply.result.protocolVersion).toBe("2024-11-05");
  });

  it("returns no reply for a notification (no id)", () => {
    expect(handleRequest({ method: "notifications/initialized" })).toBeNull();
  });

  it("lists exactly the lint_tools tool", () => {
    const reply = handleRequest({ id: 2, method: "tools/list" }) as {
      result: { tools: unknown[] };
    };
    expect(reply.result.tools).toEqual([LINT_TOOLS_TOOL]);
  });
});

describe("mcplint MCP server — tools/call lint_tools", () => {
  it("lints a tools array and returns the score + findings", () => {
    const reply = handleRequest({
      id: 3,
      method: "tools/call",
      params: { name: "lint_tools", arguments: { tools: GOOD_TOOLS } },
    }) as { result: { isError: boolean; structuredContent: LintResult } };

    expect(reply.result.isError).toBe(false);
    const expected = lint(parseTools(GOOD_TOOLS));
    expect(reply.result.structuredContent).toEqual(expected);
    expect(reply.result.structuredContent.score).toBe(100);
  });

  it("accepts a tools/list envelope payload too", () => {
    const reply = handleRequest({
      id: 4,
      method: "tools/call",
      params: { name: "lint_tools", arguments: { tools: { tools: GOOD_TOOLS } } },
    }) as { result: { structuredContent: LintResult } };
    expect(reply.result.structuredContent.toolCount).toBe(1);
  });

  it("scores a bad payload below 100 and reports findings", () => {
    const bad = [{ name: "do thing", description: "TODO" }];
    const reply = handleRequest({
      id: 5,
      method: "tools/call",
      params: { name: "lint_tools", arguments: { tools: bad } },
    }) as { result: { isError: boolean; structuredContent: LintResult } };
    expect(reply.result.isError).toBe(false);
    expect(reply.result.structuredContent.score).toBeLessThan(100);
    expect(reply.result.structuredContent.findings.length).toBeGreaterThan(0);
  });

  it("returns a tool-level error (not a crash) for an unparseable payload", () => {
    const reply = handleRequest({
      id: 6,
      method: "tools/call",
      params: { name: "lint_tools", arguments: { tools: 42 } },
    }) as { result: { isError: boolean; content: { text: string }[] } };
    expect(reply.result.isError).toBe(true);
    expect(reply.result.content[0]?.text).toMatch(/could not parse/);
  });

  it("rejects a call with the tools argument missing", () => {
    const reply = handleRequest({
      id: 7,
      method: "tools/call",
      params: { name: "lint_tools", arguments: {} },
    }) as { error: { code: number; message: string } };
    expect(reply.error.message).toMatch(/Missing required argument/);
  });

  it("returns method-not-found for an unknown tool name", () => {
    const reply = handleRequest({
      id: 8,
      method: "tools/call",
      params: { name: "no_such_tool", arguments: {} },
    }) as { error: { code: number } };
    expect(reply.error.code).toBe(-32601);
  });
});

describe("mcplint MCP server — protocol hygiene", () => {
  it("errors on an unknown request method", () => {
    const reply = handleRequest({ id: 9, method: "resources/list" }) as {
      error: { code: number };
    };
    expect(reply.error.code).toBe(-32601);
  });

  it("the exposed tool definition passes mcplint's own rules (dogfood)", () => {
    const result = lint(parseTools([LINT_TOOLS_TOOL]));
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });
});
