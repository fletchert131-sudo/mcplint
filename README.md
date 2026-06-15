# mcplint

Lint and score your **MCP server's tool definitions before you publish** — so the
model can actually choose them, and they don't quietly bloat every request's
context window.

mcplint checks name/schema validity, description quality, token weight, and safety
on destructive tools, then gives you a 0–100 score and a CI gate.

## Quick start

```bash
npx mcplint examples/sample-tools.json
```

Lint a **static file** — a tools array, or an MCP `tools/list` result (`{ "tools": [...] }`):

```bash
mcplint tools.json                 # lint + score (free)
mcplint tools.json --ci --min 90   # exit 1 below 90 — drop into CI (free)
mcplint tools.json --json          # machine-readable
mcplint tools.json --report        # shareable Markdown report (Pro)
```

Or lint a **live server** — mcplint spawns it, runs `initialize` + `tools/list`
over stdio, and lints exactly what it advertises to a model. Put the server's
own command and args after a literal `--`:

```bash
mcplint --cmd node --ci -- dist/server.js          # lint your built server in CI
mcplint --cmd npx -- -y @scope/your-mcp-server     # lint a published server
mcplint --cmd python --json -- -m your_server      # any stdio MCP server
```

Everything after `--` is passed to the server untouched, so its flags can never
clash with mcplint's (and can't silently disarm `--ci`). The live path runs the
same rules and scoring as the file path — so a passing file is a passing server.

## What it checks

- valid, unique tool names (`[A-Za-z0-9_-]`, ≤ 128 chars — `snake_case` and
  `kebab-case` both pass, per the MCP spec)
- present, useful, non-placeholder descriptions — not too short, not token-bloated
- object input schemas; required params actually defined in properties
- destructive tools (`delete`/`drop`/`exec`…) flag their risk in the description

> Destructive detection is deliberately conservative: names like `reset_password`
> or `execute_query` draw a `destructive-safety` **warning** (not an error) —
> document the risk in the description to clear it.

## Free vs Pro

- **Free** (no key, always works): lint, score, `--json`, and the `--ci` gate.
- **Pro**: `--report` export and watch mode. Set `MCPLINT_LICENSE_KEY`.

## Use as a library

```ts
import { lint, parseTools } from "mcplint";

const result = lint(parseTools(JSON.parse(rawJson)));
console.log(result.score, result.findings);
```

MIT-licensed engine. Automated linting catches structure and hygiene, not intent —
review findings in context.
