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
npx tsx src/cli.ts examples/sample-tools.json   # dev run
```

## Invariants — do not break
- **Free tier always works**: lint, score, `--json`, `--ci` never require a key.
- **Pro degrades gracefully**: `--report` without a licence throws a friendly,
  actionable error (`requirePro`), never a stack trace.
- **Engine is pure**: `src/core/*` does no I/O — all reads/writes live in
  `cli.ts`. That's what keeps the rules testable with no network.
- **Tests need no network or API key.**
- **Honest output**: keep the "linting catches structure, not intent" disclaimer.

## Architecture
```
src/core/   MIT engine (pure)
  types.ts   data shapes
  rules.ts   the MCP-specific checks (names, descriptions, schema, token weight, safety)
  score.ts   0-100 scoring + token estimate
  lint.ts    parse a tools payload (array or tools/list envelope) + run rules
src/pro/    licensed
  license.ts LemonSqueezy verify + 14-day offline grace + MCPLINT_DEV=1 bypass
  report.ts  Markdown report export
src/cli.ts  the CLI surface     src/index.ts  the library API
```

## Roadmap (build in order)
1. Live server linting — spawn an MCP server and lint its `tools/list` over stdio
   (currently file-only, which keeps v0 deterministic + testable).
2. HTML report (`--report` is Markdown-only today).
3. watch mode + multi-server view (Pro).
4. Expose mcplint itself as an MCP server (dogfood).
```
