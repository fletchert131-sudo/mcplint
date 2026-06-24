import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lintMany, multiCiFails, sourceLabel, type Source } from "../src/cli.js";

/** Integration test for the multi-server view (Pro): lint several sources —
 *  real files AND a real live fixture server — in one pass, then check the
 *  combined CI gate. No mocks, no network (the fixture is a local node child). */

const SERVER = fileURLToPath(new URL("./fixtures/fake-mcp-server.mjs", import.meta.url));

const created: string[] = [];
afterEach(async () => {
  for (const f of created.splice(0)) await fs.rm(f, { force: true });
});

async function tmpJson(name: string, content: unknown): Promise<string> {
  const p = join(tmpdir(), `mcplint-multi-${process.pid}-${Date.now()}-${name}`);
  await fs.writeFile(p, JSON.stringify(content), "utf8");
  created.push(p);
  return p;
}

const cleanTool = {
  name: "search_invoices",
  description: "Search invoices by customer or status. Use when the user asks to find or filter invoices.",
  inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
};

/** A live source pointing at the local fixture server in a given MODE. The
 *  mode is passed as a CLI arg (the fixture reads argv[2]) so the Source stays
 *  exactly the shape the real CLI produces: command + args, no env. */
function live(mode: string): Source {
  return { kind: "live", command: process.execPath, args: [SERVER, mode] };
}

describe("lintMany — combined pass over several sources", () => {
  it("lints two files and a live server in one pass, preserving order", async () => {
    const a = await tmpJson("a.json", [cleanTool]);
    const b = await tmpJson("b.json", { tools: [cleanTool] });
    const entries = await lintMany([{ kind: "file", file: a }, { kind: "file", file: b }, live("good")]);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual([a, b, sourceLabel(live("good"))]);
    for (const e of entries) {
      expect("result" in e).toBe(true);
      if ("result" in e) expect(e.result.score).toBe(100);
    }
  });

  it("reports per-source failure without aborting the whole pass", async () => {
    const good = await tmpJson("good.json", [cleanTool]);
    const entries = await lintMany([
      { kind: "file", file: good },
      { kind: "file", file: join(tmpdir(), "mcplint-does-not-exist.json") },
      live("bad-tools"),
    ]);

    expect(entries).toHaveLength(3);
    expect("result" in entries[0]!).toBe(true); // good file linted
    expect("fail" in entries[1]!).toBe(true); // missing file -> per-source failure, not a throw
    // the live bad-tools server still linted (with findings), not skipped
    expect("result" in entries[2]!).toBe(true);
    if ("result" in entries[2]!) expect(entries[2]!.result.counts.error).toBeGreaterThan(0);
  });
});

describe("multiCiFails — gate fails if ANY source breaches", () => {
  it("passes when every source is clean and at/above the threshold", async () => {
    const a = await tmpJson("a.json", [cleanTool]);
    const entries = await lintMany([{ kind: "file", file: a }, live("good")]);
    expect(multiCiFails(entries, 80)).toBe(false);
  });

  it("fails when any source has errors", async () => {
    const a = await tmpJson("a.json", [cleanTool]);
    const entries = await lintMany([{ kind: "file", file: a }, live("bad-tools")]);
    expect(multiCiFails(entries, 80)).toBe(true);
  });

  it("fails when any source scores below the threshold", async () => {
    const a = await tmpJson("a.json", [cleanTool]);
    const entries = await lintMany([{ kind: "file", file: a }, live("good")]);
    // both score 100; a threshold above 100 can never be met -> fails
    expect(multiCiFails(entries, 101 as unknown as number)).toBe(true);
  });

  it("fails when any source could not be linted at all", async () => {
    const a = await tmpJson("a.json", [cleanTool]);
    const entries = await lintMany([
      { kind: "file", file: a },
      { kind: "file", file: join(tmpdir(), "mcplint-missing.json") },
    ]);
    expect(multiCiFails(entries, 0)).toBe(true);
  });
});
