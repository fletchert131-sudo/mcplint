# mcplint — agent maintenance guide

Open-core CLI + library that lints & scores MCP server tool definitions. Free
lint/score/CI; paid report export + watch. Built 13 Jun 2026 as the agent-setup
**proving venture** (validates the global `coding` agent vs the Fable benchmark;
see `Projects\ops (nightly orchestrator)\AGENT-ARCHITECTURE.md`).

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
- **Pro degrades gracefully**: `--report` without a licence throws a friendly,
  actionable error (`requirePro`), never a stack trace.
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
src/pro/     licensed
  license.ts  LemonSqueezy verify + 14-day offline grace + MCPLINT_DEV=1 bypass
  report.ts   Markdown report export
src/cli.ts   the CLI surface (file + --cmd live sources)   src/index.ts  the library API
```

## Roadmap (build in order)
1. ~~Live server linting~~ DONE — `--cmd <server> [-- <args…>]` spawns an MCP
   server and lints its `tools/list` over stdio (`src/connect/stdio.ts`). The
   static file path stays for deterministic CI.
2. HTML report (`--report` is Markdown-only today).
3. watch mode + multi-server view (Pro).
4. Expose mcplint itself as an MCP server (dogfood).
5. Provider abstraction — make the licence store a config switch (LemonSqueezy/
   Gumroad) per the a11ygent pattern (ENHANCED-TODO in src/pro/license.ts).
```
