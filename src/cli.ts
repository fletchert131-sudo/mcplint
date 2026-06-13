#!/usr/bin/env node
/** mcplint CLI.
 *  Free: lint + score + text/JSON output + the --ci gate (always works, no key).
 *  Pro:  --report (shareable Markdown file), gated by a licence.
 *  Exit codes: 0 ok · 1 CI threshold breached or errors found · 2 usage/IO error. */
import { promises as fs } from "node:fs";
import { lint, McpLintError, parseTools } from "./core/lint.js";
import type { LintResult, Severity } from "./core/types.js";
import { toMarkdown } from "./pro/report.js";
import { requirePro } from "./pro/license.js";

class UsageError extends Error {}

interface Args {
  file: string;
  ci: boolean;
  json: boolean;
  min: number;
  report: boolean;
  out: string | undefined;
}

function parseArgs(argv: string[]): Args {
  let file: string | undefined;
  let ci = false;
  let json = false;
  let min = 80;
  let report = false;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    switch (a) {
      case "--ci": ci = true; break;
      case "--json": json = true; break;
      case "--report": report = true; break;
      case "--min": min = Number(argv[++i]); break;
      case "--out": out = argv[++i]; break;
      case "-h":
      case "--help": printHelp(); process.exit(0);
      default:
        if (a.startsWith("-")) throw new UsageError(`Unknown option: ${a}`);
        if (file !== undefined) throw new UsageError("Only one input file is supported.");
        file = a;
    }
  }
  if (file === undefined) {
    throw new UsageError("Usage: mcplint <tools.json> [--ci] [--min <0-100>] [--json] [--report] [--out <file>]");
  }
  if (!Number.isFinite(min) || min < 0 || min > 100) {
    throw new UsageError("--min must be a number between 0 and 100.");
  }
  return { file, ci, json, min, report, out };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let raw: string;
  try {
    raw = await fs.readFile(args.file, "utf8");
  } catch {
    return fail(2, `Cannot read file: ${args.file}`);
  }

  let result: LintResult;
  try {
    result = lint(parseTools(JSON.parse(raw)));
  } catch (err) {
    if (err instanceof McpLintError) return fail(2, err.message);
    return fail(2, `Invalid JSON in ${args.file}: ${(err as Error).message}`);
  }

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printText(result, args.file);
  }

  if (args.report) {
    await requirePro("report export"); // throws a friendly error if unlicensed
    const out = args.out ?? "mcplint-report.md";
    await fs.writeFile(out, toMarkdown(result, args.file), "utf8");
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
  mcplint <tools.json> [options]

Input: a JSON file with a tools array, or an MCP tools/list result ({ "tools": [...] }).

Options:
  --ci            exit 1 if score < --min or any errors (CI gate)
  --min <0-100>   CI threshold (default 80)
  --json          machine-readable output
  --report        write a shareable Markdown report (Pro)
  --out <file>    report path (default mcplint-report.md)
  -h, --help      show this help
`);
}

function fail(code: number, message: string): never {
  process.stderr.write(`mcplint: ${message}\n`);
  process.exit(code);
}

main().catch((err) => {
  if (err instanceof UsageError) fail(2, err.message);
  fail(2, err instanceof Error ? err.message : String(err));
});
