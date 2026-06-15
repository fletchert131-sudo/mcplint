import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { fetchToolsOverStdio, McpConnectError } from "../src/connect/stdio.js";
import { lint, parseTools } from "../src/core/lint.js";

const SERVER = fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url));

/** Spawn the fake server in a given MODE and return its tools. Uses the real
 *  connector + a real child process — no mocks, no network. */
function connect(mode: string, overrides: Record<string, unknown> = {}) {
  return fetchToolsOverStdio({
    command: process.execPath, // the node binary running these tests
    args: [SERVER],
    env: { ...process.env, MODE: mode },
    timeoutMs: 5_000,
    ...overrides,
  });
}

describe("fetchToolsOverStdio — happy path", () => {
  it("completes the handshake and returns the server's tools", async () => {
    const tools = await connect("good");
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(2);
  });

  it("feeds straight into the pure engine and scores clean tools 100", async () => {
    const tools = await connect("good");
    const result = lint(parseTools(tools));
    expect(result.toolCount).toBe(2);
    expect(result.score).toBe(100);
    expect(result.findings).toHaveLength(0);
  });

  it("lints a live server's bad tools just like a file", async () => {
    const tools = await connect("bad-tools");
    const result = lint(parseTools(tools));
    expect(result.counts.error).toBeGreaterThan(0);
    expect(result.findings.some((f) => f.ruleId === "name-format")).toBe(true);
    expect(result.findings.some((f) => f.ruleId === "destructive-safety")).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it("tolerates a server that logs a stray non-JSON line to stdout", async () => {
    const tools = await connect("noise");
    expect(tools).toHaveLength(2);
  });
});

describe("fetchToolsOverStdio — failure paths (all fail closed, with reasons)", () => {
  it("rejects when the server binary does not exist", async () => {
    await expect(
      fetchToolsOverStdio({ command: "definitely-not-a-real-binary-xyz", timeoutMs: 5_000 }),
    ).rejects.toBeInstanceOf(McpConnectError);
  });

  it("rejects with the server's JSON-RPC error message", async () => {
    await expect(connect("rpc-error")).rejects.toThrow(/tools not supported/);
  });

  it("rejects when tools/list has no tools array", async () => {
    await expect(connect("no-tools")).rejects.toThrow(/no 'tools' array/);
  });

  it("rejects when the server exits before completing the handshake", async () => {
    await expect(connect("crash")).rejects.toThrow(/before completing the handshake/);
  });

  it("times out a server that never answers tools/list", async () => {
    await expect(connect("hang", { timeoutMs: 400 })).rejects.toThrow(/within 400ms/);
  });

  it("rejects an empty command without spawning anything", async () => {
    await expect(fetchToolsOverStdio({ command: "   " })).rejects.toThrow(/server command is required/);
  });
});
