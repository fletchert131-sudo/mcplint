import { describe, it, expect } from "vitest";
import { parseArgs } from "../src/cli.js";

describe("parseArgs — file source", () => {
  it("parses a bare file path", () => {
    const a = parseArgs(["tools.json"]);
    expect(a.source).toEqual({ kind: "file", file: "tools.json" });
    expect(a.min).toBe(80);
  });

  it("parses CI flags", () => {
    const a = parseArgs(["tools.json", "--ci", "--min", "90", "--json"]);
    expect(a.ci).toBe(true);
    expect(a.min).toBe(90);
    expect(a.json).toBe(true);
  });

  it("rejects two input files", () => {
    expect(() => parseArgs(["a.json", "b.json"])).toThrow(/Only one input file/);
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

  it("requires some input", () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
  });
});

describe("parseArgs — live source", () => {
  it("parses --cmd with no args", () => {
    const a = parseArgs(["--cmd", "node"]);
    expect(a.source).toEqual({ kind: "live", command: "node", args: [] });
  });

  it("passes everything after -- to the server verbatim", () => {
    const a = parseArgs(["--cmd", "npx", "--", "-y", "@scope/srv", "--port", "0"]);
    expect(a.source).toEqual({ kind: "live", command: "npx", args: ["-y", "@scope/srv", "--port", "0"] });
  });

  it("keeps mcplint flags on its side of --, server flags after", () => {
    const a = parseArgs(["--cmd", "node", "--ci", "--min", "95", "--", "server.js", "--verbose"]);
    expect(a.ci).toBe(true);
    expect(a.min).toBe(95);
    expect(a.source).toEqual({ kind: "live", command: "node", args: ["server.js", "--verbose"] });
  });

  // Regression: the foot-gun caught in verification. A server flag named like
  // an mcplint flag must NOT be interpreted by mcplint and silently disarm the
  // gate. After --, `--ci` belongs to the server; mcplint's own ci stays off.
  it("does NOT let a server-side --ci (after --) arm mcplint's gate", () => {
    const a = parseArgs(["--cmd", "node", "--", "server.js", "--ci"]);
    expect(a.ci).toBe(false);
    expect(a.source).toEqual({ kind: "live", command: "node", args: ["server.js", "--ci"] });
  });

  it("rejects a file and --cmd together", () => {
    expect(() => parseArgs(["tools.json", "--cmd", "node"])).toThrow(/either a tools file or --cmd/);
  });

  it("rejects args after -- without --cmd", () => {
    expect(() => parseArgs(["--", "server.js"])).toThrow(/only valid together with --cmd/);
  });

  it("rejects --cmd with no command", () => {
    expect(() => parseArgs(["--cmd"])).toThrow(/--cmd needs a server command/);
  });
});
