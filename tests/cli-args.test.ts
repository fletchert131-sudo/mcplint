import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs — file source", () => {
  it("parses a bare file path", () => {
    const a = parseArgs(["tools.json"]);
    expect(a.sources).toEqual([{ kind: "file", file: "tools.json" }]);
    expect(a.min).toBe(80);
  });

  it("parses CI flags", () => {
    const a = parseArgs(["tools.json", "--ci", "--min", "90", "--json"]);
    expect(a.ci).toBe(true);
    expect(a.min).toBe(90);
    expect(a.json).toBe(true);
  });

  it("rejects an out-of-range --min", () => {
    expect(() => parseArgs(["tools.json", "--min", "150"])).toThrow(/between 0 and 100/);
  });

  it("rejects a non-numeric --min", () => {
    expect(() => parseArgs(["tools.json", "--min", "8o"])).toThrow(/between 0 and 100/);
  });

  it("rejects an unknown option", () => {
    expect(() => parseArgs(["tools.json", "--frobnicate"])).toThrow(/Unknown option/);
  });

  it("defaults the report format to md", () => {
    expect(parseArgs(["tools.json"]).format).toBe("md");
  });

  it("parses --format html", () => {
    const a = parseArgs(["tools.json", "--report", "--format", "html"]);
    expect(a.report).toBe(true);
    expect(a.format).toBe("html");
  });

  it("rejects an unsupported --format", () => {
    expect(() => parseArgs(["tools.json", "--format", "pdf"])).toThrow(/md or html/);
  });

  it("requires some input", () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
  });
});

describe("parseArgs — live source", () => {
  it("parses --cmd with no args", () => {
    const a = parseArgs(["--cmd", "node"]);
    expect(a.sources).toEqual([{ kind: "live", command: "node", args: [] }]);
  });

  it("passes everything after -- to the server verbatim", () => {
    const a = parseArgs(["--cmd", "npx", "--", "-y", "@scope/srv", "--port", "0"]);
    expect(a.sources).toEqual([{ kind: "live", command: "npx", args: ["-y", "@scope/srv", "--port", "0"] }]);
  });

  it("keeps mcplint flags on its side of --, server flags after", () => {
    const a = parseArgs(["--cmd", "node", "--ci", "--min", "95", "--", "server.js", "--verbose"]);
    expect(a.ci).toBe(true);
    expect(a.min).toBe(95);
    expect(a.sources).toEqual([{ kind: "live", command: "node", args: ["server.js", "--verbose"] }]);
  });

  // Regression: the foot-gun caught in verification. A server flag named like
  // an mcplint flag must NOT be interpreted by mcplint and silently disarm the
  // gate. After --, `--ci` belongs to the server; mcplint's own ci stays off.
  it("does NOT let a server-side --ci (after --) arm mcplint's gate", () => {
    const a = parseArgs(["--cmd", "node", "--", "server.js", "--ci"]);
    expect(a.ci).toBe(false);
    expect(a.sources).toEqual([{ kind: "live", command: "node", args: ["server.js", "--ci"] }]);
  });

  it("combines a file and --cmd into a multi-source pass (the Pro view)", () => {
    const a = parseArgs(["tools.json", "--cmd", "node", "--", "server.js"]);
    expect(a.multi).toBe(true);
    expect(a.sources).toEqual([
      { kind: "file", file: "tools.json" },
      { kind: "live", command: "node", args: ["server.js"] },
    ]);
  });

  it("rejects args after -- without --cmd", () => {
    expect(() => parseArgs(["--", "server.js"])).toThrow(/only valid together with --cmd/);
  });

  it("rejects --cmd with no command", () => {
    expect(() => parseArgs(["--cmd"])).toThrow(/--cmd needs a server command/);
  });
});

describe("parseArgs — watch mode", () => {
  it("parses --watch (off by default)", () => {
    expect(parseArgs(["tools.json"]).watch).toBe(false);
    expect(parseArgs(["tools.json", "--watch"]).watch).toBe(true);
  });

  it("watches a live server too", () => {
    const a = parseArgs(["--cmd", "node", "--watch", "--", "server.js"]);
    expect(a.watch).toBe(true);
    expect(a.sources).toEqual([{ kind: "live", command: "node", args: ["server.js"] }]);
  });

  it("defaults the live poll interval and accepts an override", () => {
    expect(parseArgs(["--cmd", "node", "--watch"]).intervalMs).toBe(3000);
    expect(parseArgs(["--cmd", "node", "--watch", "--interval", "10"]).intervalMs).toBe(10000);
  });

  it("rejects an interval below the floor", () => {
    expect(() => parseArgs(["--cmd", "node", "--watch", "--interval", "0"])).toThrow(/--interval/);
  });

  it("rejects a non-numeric interval", () => {
    expect(() => parseArgs(["--cmd", "node", "--watch", "--interval", "soon"])).toThrow(/--interval/);
  });

  // --watch is an interactive, never-exits mode; --ci is a one-shot exit-code
  // gate. Combining them is a contradiction that would mask the gate, so reject
  // it loudly rather than silently pick one.
  it("rejects --watch together with --ci", () => {
    expect(() => parseArgs(["tools.json", "--watch", "--ci"])).toThrow(/--watch.*--ci|--ci.*--watch/);
  });
});

describe("parseArgs — multi-source (Pro)", () => {
  it("parses several files into ordered sources", () => {
    const a = parseArgs(["a.json", "b.json", "c.json"]);
    expect(a.sources).toEqual([
      { kind: "file", file: "a.json" },
      { kind: "file", file: "b.json" },
      { kind: "file", file: "c.json" },
    ]);
  });

  it("combines files with one live server, files first then the --cmd source", () => {
    const a = parseArgs(["a.json", "b.json", "--cmd", "node", "--", "server.js"]);
    expect(a.sources).toEqual([
      { kind: "file", file: "a.json" },
      { kind: "file", file: "b.json" },
      { kind: "live", command: "node", args: ["server.js"] },
    ]);
  });

  // Multi-source is the Pro increment; the parser flags it so the CLI can gate
  // and forbid the per-source-only modes up front.
  it("flags a single source as not multi, and 2+ sources as multi", () => {
    expect(parseArgs(["a.json"]).multi).toBe(false);
    expect(parseArgs(["--cmd", "node"]).multi).toBe(false);
    expect(parseArgs(["a.json", "b.json"]).multi).toBe(true);
    expect(parseArgs(["a.json", "--cmd", "node"]).multi).toBe(true);
  });

  // --report and --watch render/track a single LintResult; combining them with
  // multiple sources is ambiguous, so reject it loudly rather than silently
  // reporting only one source.
  it("rejects --report with multiple sources", () => {
    expect(() => parseArgs(["a.json", "b.json", "--report"])).toThrow(/single source|one source/i);
  });

  it("rejects --watch with multiple sources", () => {
    expect(() => parseArgs(["a.json", "b.json", "--watch"])).toThrow(/single source|one source/i);
  });
});
