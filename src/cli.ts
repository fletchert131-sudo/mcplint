#!/usr/bin/env node
/** mcplint CLI.
 *  Free: lint + score + text/JSON output + the --ci gate (always works, no key).
 *  Pro:  --report (shareable Markdown or --format html file), gated by a licence.
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
import { toMarkdown, toHtml, type ReportFormat } from "./pro/report.js";
import { requirePro } from "./pro/license.js";
import { fetchToolsOverStdio, McpConnectError } from "./connect/stdio.js";
import { startWatch, type WatchTarget } from "./watch/source.js";

class UsageError extends Error {}

/** Quiet period after the last file/poll event before a re-lint fires. Long
 *  enough to coalesce an editor's save burst, short enough to feel instant. */
const WATCH_DEBOUNCE_MS = 250;

/** Where the tools come from: a static file, or a live server over stdio. */
export type Source =
  | { kind: "file"; file: string }
  | { kind: "live"; command: string; args: string[] };

interface Args {
  /** Every source to lint, in CLI order: files first, then an optional --cmd
   *  live server. One source is the free path; two or more is the Pro
   *  multi-server view (`multi` is true). */
  sources: Source[];
  /** True when more than one source was given — the Pro multi-server view. */
  multi: boolean;
  ci: boolean;
  json: boolean;
  min: number;
  report: boolean;
  format: ReportFormat;
  out: string | undefined;
  watch: boolean;
  /** Re-lint poll interval for a live (`--cmd`) source under --watch, in ms. */
  intervalMs: number;
}

/** Default re-lint interval for a live server under --watch (ms). A live source
 *  has no file to watch, so we re-run the handshake on a timer. */
const DEFAULT_INTERVAL_MS = 3_000;
/** Floor on --interval so a typo can't busy-spawn the server every few ms. */
const MIN_INTERVAL_MS = 500;

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

  const files: string[] = [];
  let command: string | undefined;
  let ci = false;
  let json = false;
  let min = 80;
  let report = false;
  let format: ReportFormat = "md";
  let out: string | undefined;
  let watch = false;
  let interval: number | undefined;

  for (let i = 0; i < ownArgv.length; i++) {
    const a = ownArgv[i] as string;
    switch (a) {
      case "--ci": ci = true; break;
      case "--json": json = true; break;
      case "--report": report = true; break;
      case "--watch": watch = true; break;
      case "--interval": {
        const v = Number(ownArgv[++i]);
        // The flag takes seconds (human-friendly); we store ms internally.
        if (!Number.isFinite(v) || v <= 0) throw new UsageError("--interval must be a positive number of seconds.");
        interval = v * 1000;
        break;
      }
      case "--format": {
        const v = ownArgv[++i];
        if (v !== "md" && v !== "html") throw new UsageError("--format must be md or html.");
        format = v;
        break;
      }
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
        // Multiple positional files are allowed — they become multiple sources
        // (the Pro multi-server view). Order is preserved.
        files.push(a);
    }
  }

  if (serverArgs.length > 0 && command === undefined) {
    throw new UsageError("Args after `--` are only valid together with --cmd (they're passed to the server).");
  }
  if (command === undefined && files.length === 0) {
    throw new UsageError(
      "Usage: mcplint <tools.json> [more.json …] [--cmd <server> [-- <args…>]] [--ci] [--min <0-100>] [--json]\n" +
        "       single source also supports: [--report] [--format md|html] [--out <file>] [--watch]",
    );
  }
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new UsageError("--min must be a number between 0 and 100.");
  }
  // --watch never exits; --ci is a one-shot exit-code gate. Refuse the
  // contradiction rather than silently letting watch swallow the gate.
  if (watch && ci) {
    throw new UsageError("--watch and --ci can't be combined: watch mode never exits, the CI gate does.");
  }
  if (interval !== undefined && interval < MIN_INTERVAL_MS) {
    throw new UsageError(`--interval must be at least ${MIN_INTERVAL_MS / 1000} seconds.`);
  }

  // Build sources in CLI order: each file, then the optional live --cmd source.
  const sources: Source[] = files.map((file) => ({ kind: "file" as const, file }));
  if (command !== undefined) sources.push({ kind: "live", command, args: serverArgs });
  const multi = sources.length > 1;

  // --report renders one LintResult and --watch tracks one source; both are
  // single-source by design. Reject them with multiple sources rather than
  // silently acting on only the first.
  if (multi && report) {
    throw new UsageError("--report works on a single source — run it once per source.");
  }
  if (multi && watch) {
    throw new UsageError("--watch tracks a single source — run it once per source.");
  }

  return { sources, multi, ci, json, min, report, format, out, watch, intervalMs: interval ?? DEFAULT_INTERVAL_MS };
}

/** A human-readable label for the input source, used in output headers. */
export function sourceLabel(source: Source): string {
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

/** One source's outcome in a multi-source pass: either its lint result or the
 *  reason it couldn't be linted. A label is always present so the combined
 *  summary names every row, success or failure. */
export type MultiEntry =
  | { label: string; result: LintResult }
  | { label: string; fail: { code: number; message: string } };

/** Lint several sources in one pass (the Pro multi-server view). Each source is
 *  linted independently through the same `lintSource` as the single-source
 *  path — so a row in the combined summary is identical to running that source
 *  alone. One source failing (missing file, dead server) is recorded as its own
 *  failed row and never aborts the others: a multi-source run should report on
 *  every source it was asked about. Sources are linted sequentially to bound
 *  the number of concurrently spawned live servers. */
export async function lintMany(sources: Source[]): Promise<MultiEntry[]> {
  const entries: MultiEntry[] = [];
  for (const source of sources) {
    const label = sourceLabel(source);
    const outcome = await lintSource(source);
    entries.push("fail" in outcome ? { label, fail: outcome.fail } : { label, result: outcome.result });
  }
  return entries;
}

/** The combined CI gate: fail if ANY source breaches. A source breaches when it
 *  couldn't be linted at all (a failed row is never a silent pass — that would
 *  be a permanent green, the worst gate failure), or its score is below `min`,
 *  or it has any errors. Pure over the entries so it's testable without I/O. */
export function multiCiFails(entries: MultiEntry[], min: number): boolean {
  return entries.some((e) =>
    "fail" in e ? true : e.result.score < min || e.result.counts.error > 0,
  );
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

/** Print the result (text or JSON) and, if --report, write the report file.
 *  Shared by the one-shot path and every iteration of watch mode, so a watched
 *  re-lint emits exactly what a one-shot run would. */
async function emitResult(result: LintResult, args: Args, label: string): Promise<void> {
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(result, label);
  }
  if (args.report) {
    const out = args.out ?? (args.format === "html" ? "mcplint-report.html" : "mcplint-report.md");
    const content = args.format === "html" ? toHtml(result, label) : toMarkdown(result, label);
    await fs.writeFile(out, content, "utf8");
    if (!args.json) process.stderr.write(`Report written to ${out}\n`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Gate Pro features up front so an unlicensed user gets one friendly message
  // before any linting or watching work — never a stack trace, never a half-run.
  // The multi-server view is itself a Pro feature; the single-source path stays
  // free (the free-tier invariant).
  if (args.report) await requirePro("report export");
  if (args.watch) await requirePro("watch mode");
  if (args.multi) await requirePro("multi-server view");

  if (args.multi) return runMulti(args);

  const single = args.sources[0] as Source;
  const label = sourceLabel(single);

  if (args.watch) return runWatch(args, single, label);

  const outcome = await lintSource(single);
  if ("fail" in outcome) return fail(outcome.fail.code, outcome.fail.message);
  const result = outcome.result;

  await emitResult(result, args, label);

  const failing = args.ci && (result.score < args.min || result.counts.error > 0);
  process.exit(failing ? 1 : 0);
}

/** Multi-server view (Pro): lint every source in one pass and print a combined
 *  summary. Each source is reported on its own row (success or failure); the
 *  --ci gate fails if ANY source breaches. Mirrors the single-source path's
 *  text/JSON split, so a row reads identically to running that source alone. */
async function runMulti(args: Args): Promise<void> {
  const entries = await lintMany(args.sources);

  if (args.json) {
    // Machine-readable: one object per source, mapping label -> result | error.
    const payload = entries.map((e) =>
      "result" in e ? { source: e.label, result: e.result } : { source: e.label, error: e.fail.message },
    );
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else {
    printMultiSummary(entries);
  }

  const failing = args.ci && multiCiFails(entries, args.min);
  process.exit(failing ? 1 : 0);
}

/** Watch mode (Pro): lint once, then re-lint + re-emit on every change, never
 *  exiting until the user quits (Ctrl-C). A single bad re-lint (a half-written
 *  file, a server that failed to start this time) prints its reason and keeps
 *  watching — the whole point of watch mode is to stay up while you fix things. */
async function runWatch(args: Args, source: Source, label: string): Promise<void> {
  const runOnce = async (): Promise<void> => {
    const outcome = await lintSource(source);
    if ("fail" in outcome) {
      // In watch mode a failure is informational, not fatal: report and wait
      // for the next change rather than tearing the watcher down.
      process.stderr.write(`mcplint: ${outcome.fail.message}\n`);
      return;
    }
    await emitResult(outcome.result, args, label);
  };

  await runOnce(); // initial lint, like tsc --watch / vitest

  const target: WatchTarget =
    source.kind === "file"
      ? { kind: "file", file: source.file }
      : { kind: "interval", everyMs: args.intervalMs };

  const handle = startWatch({
    target,
    run: runOnce,
    debounceMs: WATCH_DEBOUNCE_MS,
    onError: (err) => process.stderr.write(`mcplint: re-lint failed: ${err instanceof Error ? err.message : String(err)}\n`),
  });

  const hint =
    source.kind === "file"
      ? `Watching ${label} — re-lints on save. Ctrl-C to stop.`
      : `Watching ${label} — re-lints every ${Math.round(args.intervalMs / 1000)}s. Ctrl-C to stop.`;
  process.stderr.write(`\n${hint}\n`);

  // Clean teardown on the usual quit signals so we never leak the fs handle,
  // the poll interval, or a live server child spawned by an in-flight re-lint.
  const shutdown = (): void => {
    handle.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
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

/** Print the combined summary for a multi-source pass: one line per source with
 *  its score / tool count / token weight / counts, then per-source findings for
 *  any source that has them, then an aggregate footer. A source that couldn't
 *  be linted prints its reason on its row — it's visibly failed, never hidden. */
function printMultiSummary(entries: MultiEntry[]): void {
  const out = process.stdout;
  out.write(`\nmcplint  ${entries.length} sources\n\n`);

  let totalTools = 0;
  let totalTokens = 0;
  let totalErrors = 0;
  let failedSources = 0;

  for (const e of entries) {
    if ("fail" in e) {
      failedSources++;
      out.write(`  [x] FAILED   ${e.label}\n`);
      out.write(`      ${e.fail.message}\n`);
      continue;
    }
    const r = e.result;
    totalTools += r.toolCount;
    totalTokens += r.estimatedTokens;
    totalErrors += r.counts.error;
    out.write(
      `  ${String(r.score).padStart(3)}/100  ${e.label}  ` +
        `(${r.toolCount} tools, ~${r.estimatedTokens} tokens, ${r.counts.error}E/${r.counts.warning}W/${r.counts.info}I)\n`,
    );
  }

  // Per-source findings, grouped under each source so a fix is unambiguous.
  for (const e of entries) {
    if (!("result" in e) || e.result.findings.length === 0) continue;
    out.write(`\n  ${e.label}\n`);
    for (const f of e.result.findings) {
      out.write(`    [${ICON[f.severity]}] ${f.severity.padEnd(7)} ${(f.tool ?? "-").padEnd(22)} ${f.ruleId}\n`);
      out.write(`        ${f.message}\n`);
    }
  }

  out.write(
    `\nTotal: ${entries.length} sources` +
      (failedSources ? `, ${failedSources} could not be linted` : "") +
      ` · ${totalTools} tools · ~${totalTokens} context tokens · ${totalErrors} error(s)\n\n`,
  );
  out.write("Automated linting catches structure and hygiene, not intent — review findings in context.\n\n");
}

function printHelp(): void {
  process.stdout.write(`mcplint — lint & score MCP server tool definitions

Usage:
  mcplint <tools.json> [options]               lint a tools JSON file
  mcplint --cmd <server> [-- <server-args…>] [options]
                                               lint a live server over stdio
  mcplint <a.json> <b.json> [--cmd <server>] [options]
                                               lint several sources in one pass (Pro)

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
  --report        write a shareable report (Pro)
  --format md|html  report format (default md)
  --out <file>    report path (default mcplint-report.<md|html>)
  --watch         re-lint on change and re-emit, until you quit (Pro)
  --interval <s>  re-lint a live (--cmd) server every <s> seconds under --watch (default 3)
  -h, --help      show this help

Multi-source (Pro): give several files and/or one --cmd server to lint them in
one pass with a combined summary; --ci then fails if ANY source breaches.
(--report and --watch act on a single source — run them once per source.)

Examples:
  mcplint tools.json --ci --min 90
  mcplint --cmd node --ci -- dist/server.js
  mcplint --cmd npx --json -- -y @scope/my-mcp-server
  mcplint tools.json --watch
  mcplint --cmd node --watch -- dist/server.js
  mcplint a.json b.json --cmd node --ci -- dist/server.js
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
