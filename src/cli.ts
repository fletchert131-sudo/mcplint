#!/usr/bin/env node
/** mcplint CLI.
 *  Free: lint + score + text/JSON output + the --ci gate (always works, no key).
 *  Pro:  --report (shareable Markdown file), gated by a licence.
 *  Exit codes: 0 ok · 1 CI threshold breached or errors found · 2 usage/IO error.
 *
 *  Two input sources, same engine:
 *    - a tools JSON file (static, deterministic)
 *    - --cmd <server> [--args …]: spawn a live MCP server and lint its
 *      tools/list over stdio. */
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";
import { lint, McpLintError, parseTools } from "./core/lint.js";
import type { LintResult, McpTool, Severity } from "./core/types.js";
import { toMarkdown } from "./pro/report.js";
import { requirePro } from "./pro/license.js";
import { fetchToolsOverStdio, McpConnectError } from "./connect/stdio.js";

class UsageError extends Error {}

/** Where the tools come from: a static file, or a live server over stdio. */
type Source =
  | { kind: "file"; file: string }
  | { kind: "live"; command: string; args: string[] };

interface Args {
  source: Source;
  ci: boolean;
  json: boolean;
  min: number;
  report: boolean;
  out: string | undefined;
}

export function parseArgs(argv: string[]): Args {
  // Split on the first literal `--`: everything after it is passed to the
  // spawned server verbatim (the universal pass-through convention — npm,
  // cargo, node all use it). This is deliberate: it means a server flag like
  // `--ci` can never be mistaken for mcplint's own `--ci` and silently disarm
  // the gate. Without this separation, `mcplint --cmd node server.js --ci`
  // would send `--ci` to the server and the CI gate would pass on everything —
  // a permanent green, the worst failure a quality gate can have.
  const sep = argv.indexOf("--");
  const ownArgv = sep === -1 ? argv : argv.slice(0, sep);
  const serverArgs = sep === -1 ? [] : argv.slice(sep + 1);

  let file: string | undefined;
  let command: string | undefined;
  let ci = false;
  let json = false;
  let min = 80;
  let report = false;
  let out: string | undefined;

  for (let i = 0; i < ownArgv.length; i++) {
    const a = ownArgv[i] as string;
    switch (a) {
      case "--ci": ci = true; break;
      case "--json": json = true; break;
      case "--report": report = true; break;
      case "--min": min = Number(ownArgv[++i]); break;
      case "--out": out = ownArgv[++i]; break;
      case "--cmd": {
        const v = ownArgv[++i];
        if (v === undefined) throw new UsageError("--cmd needs a server command (e.g. --cmd node).");
        command = v;
        break;
      }
      case "-h":
      case "--help": printHelp(); process.exit(0);
      default:
        if (a.startsWith("-")) throw new UsageError(`Unknown option: ${a}`);
        if (file !== undefined) throw new UsageError("Only one input file is supported.");
        file = a;
    }
  }

  if (command !== undefined && file !== undefined) {
    throw new UsageError("Provide either a tools file or --cmd, not both.");
  }
  if (serverArgs.length > 0 && command === undefined) {
    throw new UsageError("Args after `--` are only valid together with --cmd (they're passed to the server).");
  }
  if (command === undefined && file === undefined) {
    throw new UsageError(
      "Usage: mcplint <tools.json> [--ci] [--min <0-100>] [--json] [--report] [--out <file>]\n" +
        "   or: mcplint --cmd <server> [-- <server-args…>] [--ci] [--min <0-100>] [--json] [--report]",
    );
  }
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new UsageError("--min must be a number between 0 and 100.");
  }

  const source: Source =
    command !== undefined
      ? { kind: "live", command, args: serverArgs }
      : { kind: "file", file: file as string };
  return { source, ci, json, min, report, out };
}

/** A human-readable label for the input source, used in output headers. */
function sourceLabel(source: Source): string {
  return source.kind === "file"
    ? source.file
    : [source.command, ...source.args].join(" ");
}

/** Acquire and lint the tools from whichever source was chosen. Returns a
 *  failure code+message instead of throwing for the *expected* failure classes
 *  (unreadable file, bad JSON, unparseable tools, dead server) so each gets a
 *  distinct, actionable message and the right exit code. */
async function lintSource(source: Source): Promise<{ result: LintResult } | { fail: { code: number; message: string } }> {
  let tools: McpTool[];
  try {
    if (source.kind === "file") {
      const raw = await readFileOrFail(source.file);
      const parsed = parseJsonOrFail(raw, source.file);
      tools = parseTools(parsed);
    } else {
      const rawTools = await fetchToolsOverStdio({ command: source.command, args: source.args });
      tools = parseTools(rawTools);
    }
  } catch (err) {
    if (err instanceof CliFail) return { fail: { code: err.code, message: err.message } };
    if (err instanceof McpLintError) return { fail: { code: 2, message: err.message } };
    if (err instanceof McpConnectError) return { fail: { code: 2, message: err.message } };
    // An unexpected error here is a bug in mcplint, not the user's input —
    // surface it plainly rather than blaming their server or file.
    return { fail: { code: 2, message: `mcplint internal error: ${err instanceof Error ? err.message : String(err)}` } };
  }
  return { result: lint(tools) };
}

/** Distinguishes our own expected failures (with an exit code) from engine
 *  errors, so `lintSource` can map each class to the right message. */
class CliFail extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
  }
}

async function readFileOrFail(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    throw new CliFail(2, `Cannot read file: ${file}`);
  }
}

function parseJsonOrFail(raw: string, file: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new CliFail(2, `Invalid JSON in ${file}: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const label = sourceLabel(args.source);

  const outcome = await lintSource(args.source);
  if ("fail" in outcome) return fail(outcome.fail.code, outcome.fail.message);
  const result = outcome.result;

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(result, label);
  }

  if (args.report) {
    await requirePro("report export"); // throws a friendly error if unlicensed
    const out = args.out ?? "mcplint-report.md";
    await fs.writeFile(out, toMarkdown(result, label), "utf8");
    if (!args.json) process.stderr.write(`Report written to ${out}\n`);
  }

  const failing = args.ci && (result.score < args.min || result.counts.error > 0);
  process.exit(failing ? 1 : 0);
}

const ICON: Record<Severity, string> = { error: "x", warning: "!", info: "i" };

function printText(r: LintResult, source: string): void {
  const out = process.stdout;
  out.write(`\nmcplint  ${source}\n`);
  out.write(`Score: ${r.score}/100   ${r.toolCount} tools   ~${r.estimatedTokens} context tokens\n`);
  out.write(`${r.counts.error} error(s) | ${r.counts.warning} warning(s) | ${r.counts.info} info\n\n`);
  if (r.findings.length === 0) {
    out.write("No issues found.\n\n");
  } else {
    for (const f of r.findings) {
      out.write(`  [${ICON[f.severity]}] ${f.severity.padEnd(7)} ${(f.tool ?? "-").padEnd(22)} ${f.ruleId}\n`);
      out.write(`      ${f.message}\n`);
    }
    out.write("\n");
  }
  out.write("Automated linting catches structure and hygiene, not intent — review findings in context.\n\n");
}

function printHelp(): void {
  process.stdout.write(`mcplint — lint & score MCP server tool definitions

Usage:
  mcplint <tools.json> [options]               lint a tools JSON file
  mcplint --cmd <server> [-- <server-args…>] [options]
                                               lint a live server over stdio

Input (file): a JSON tools array, or an MCP tools/list result ({ "tools": [...] }).
Input (live): mcplint spawns <server>, runs initialize + tools/list over stdio,
              and lints what it advertises. Put server args after a literal --;
              everything after it goes to the server, so its flags never clash
              with mcplint's (and can't silently disarm --ci).

Options:
  --cmd <server>  spawn this command as a live MCP server (e.g. --cmd node)
  --ci            exit 1 if score < --min or any errors (CI gate)
  --min <0-100>   CI threshold (default 80)
  --json          machine-readable output
  --report        write a shareable Markdown report (Pro)
  --out <file>    report path (default mcplint-report.md)
  -h, --help      show this help

Examples:
  mcplint tools.json --ci --min 90
  mcplint --cmd node --ci -- dist/server.js
  mcplint --cmd npx --json -- -y @scope/my-mcp-server
`);
}

function fail(code: number, message: string): never {
  process.stderr.write(`mcplint: ${message}\n`);
  process.exit(code);
}

/** True when this module is the process entrypoint (`node cli.js` / the `bin`
 *  shim), false when it's imported (e.g. by tests for `parseArgs`). Guards the
 *  side-effecting `main()` so importing the module never spawns or exits. */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err) => {
    if (err instanceof UsageError) fail(2, err.message);
    fail(2, err instanceof Error ? err.message : String(err));
  });
}
