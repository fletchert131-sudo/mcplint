@KARPATHY.md

# mcplint — agent maintenance guide

## About
Open-core CLI + library that lints & scores MCP server tool definitions. Free
lint/score/CI; paid report export + watch. This file is the maintainer's guide —
build commands, the load-bearing invariants, and the architecture map.

## Commands
```bash
npm run lint     # tsc --noEmit
npm test         # vitest, no network/API key
npm run build    # tsc -> dist/
npx tsx src/cli.ts examples/sample-tools.json          # dev run (static file)
npx tsx src/cli.ts --cmd node -- dist/server.js        # dev run (live server, stdio)
npx tsx src/cli.ts --cmd npx -- -y @scope/srv          # lint a published server
```

Live-server smoke test (needs npx + internet the first time only):
```bash
node dist/cli.js --cmd npx -- -y @modelcontextprotocol/server-everything
# expect: 13 tools, score 100/100 (a spec-compliant reference server)
```

## Invariants — do not break
- **Free tier always works**: lint, score, `--json`, `--ci`, and live `--cmd`
  linting never require a key.
- **Pro degrades gracefully**: `--report` and `--watch` without a licence throw a
  friendly, actionable error (`requirePro`), never a stack trace. The gate is
  checked up front (before any lint/watch work), so an unlicensed user gets one
  clean message, not a half-run.
- **Watch mode is bounded & non-overlapping**: `--watch` re-lints on change, but
  never runs two re-lints at once and debounces a save burst into one run
  (`src/watch/loop.ts`); a file source uses `fs.watch`, a live `--cmd` source
  polls every `--interval` seconds (floor 0.5s) since it has no file. A failed
  re-lint is informational — it prints and keeps watching, never tears the loop
  down. `--watch` + `--ci` is rejected (a never-exiting mode can't host a one-shot
  exit-code gate). SIGINT/SIGTERM tear down the fs handle, interval, and any child.
- **Engine is pure**: `src/core/*` does no I/O. File reads live in `cli.ts`;
  live-server I/O lives in `src/connect/*`. Both hand plain data to `core`.
  That's what keeps the rules testable with no network.
- **Never `shell: true`.** Live servers are spawned with `shell: false` (argv
  array, no injection). Windows `.cmd`/`.bat` shims (e.g. `npx`) are launched
  via an explicit `cmd.exe /d /s /c` with args kept as separate, self-quoted
  argv entries — never a string-built command line. See `src/connect/stdio.ts`.
- **Server flags go after `--`.** mcplint's own flags and the spawned server's
  flags are split on the first literal `--`. This is load-bearing: it stops a
  server flag named `--ci` from disarming mcplint's CI gate (a "permanent green"
  is the worst failure a gate can have). Tested in `tests/cli-args.test.ts`.
- **`name-format` follows the MCP spec**: names are `[A-Za-z0-9_-]`, ≤ 128 chars.
  Hyphenated `kebab-case` is VALID (the official servers use it) — do not
  re-tighten this to `snake_case`-only or you score spec-compliant servers 0/100.
- **Tests need no network or API key** (live tests spawn a local fixture server,
  `tests/fixtures/fake-mcp-server.mjs` — no internet).
- **Honest output**: keep the "linting catches structure, not intent" disclaimer.

## Architecture
```
src/core/    MIT engine (pure)
  types.ts    data shapes
  rules.ts    the MCP-specific checks (names, descriptions, schema, token weight, safety)
  score.ts    0-100 scoring + token estimate
  lint.ts     parse a tools payload (array or tools/list envelope) + run rules
src/connect/ live-server I/O (impure, kept out of core)
  stdio.ts    spawn an MCP server, run initialize + tools/list over stdio,
              return the raw tools array (dependency-free JSON-RPC client;
              bounded buffers, hard timeout, kills the child on every exit)
src/watch/   watch mode (Pro): re-lint on change, bounded & debounced
  loop.ts     pure scheduler — debounce + no-overlap + idempotent teardown
  source.ts   I/O driver — fs.watch (files) / interval (live) → loop.trigger()
src/pro/     licensed
  license.ts  LemonSqueezy verify + 14-day offline grace + MCPLINT_DEV=1 bypass
  report.ts   Markdown report export
src/cli.ts   the CLI surface (file + --cmd live sources)   src/index.ts  the library API
```

## Roadmap (build in order)
1. ~~Live server linting~~ DONE — `--cmd <server> [-- <args…>]` spawns an MCP
   server and lints its `tools/list` over stdio (`src/connect/stdio.ts`). The
   static file path stays for deterministic CI.
2. ~~HTML report~~ DONE — `--report --format html` writes a standalone,
   self-contained HTML report (inlined CSS, no external assets, dark-mode aware),
   behind the same Pro gate as Markdown. All untrusted tool data is HTML-escaped
   (`src/pro/report.ts:toHtml`/`esc`). `--format` defaults to `md` (backward-compat).
3. ~~watch mode~~ DONE — `--watch` re-lints on change and re-emits the score/
   report, behind the same Pro gate (`src/watch/`). Files use `fs.watch`; a live
   `--cmd` server polls every `--interval` seconds. The loop is debounced and
   never overlaps two re-lints.
4. ~~Multi-server view~~ DONE (Pro) — pass several files and/or one live `--cmd`
   server to lint them in one pass: `mcplint a.json b.json --cmd node -- srv.js`.
   `parseArgs` collects N file sources + an optional live source; `lintMany`
   lints each through the same `lintSource` as the single path (one failed
   source is its own row, never aborts the rest); `multiCiFails` fails the `--ci`
   gate if ANY source breaches (an unlintable source counts as a failure — no
   permanent green). Gated by `requirePro("multi-server view")`; single source
   stays free. `--report`/`--watch` stay single-source (rejected with multi).
   ENHANCED-TODO: N live servers in one command needs a multi-`--` grammar — a
   separate increment; today's view supports many files + one live server.
5. ~~Expose mcplint itself as an MCP server (dogfood)~~ DONE — `mcplint-mcp`
   (`dist/serve-main.js`) is a dependency-free stdio JSON-RPC server (the mirror of
   `src/connect/stdio.ts`'s client) exposing one FREE tool, `lint_tools`, which runs the
   pure `src/core` engine over a tools payload (array or tools/list envelope) and returns
   the score + findings (`structuredContent` + JSON text; a bad payload is `isError:true`,
   never a crash). `handleRequest` is the pure handler (fully tested, no I/O); `runStdioServer`
   is the only I/O — STDOUT is JSON-RPC only, logs go to stderr. No licence touched (free).
   The exposed tool passes mcplint's own rules: `mcplint --cmd node -- dist/serve-main.js`
   scores it 100/100. See `src/serve/server.ts`.
6. Provider abstraction — make the licence store a config switch (LemonSqueezy/
   Gumroad) via `MCPLINT_LICENSE_PROVIDER` (ENHANCED-TODO in src/pro/license.ts).
```
