# mcplint

Lint and score your **MCP server's tool definitions before you publish** — so the
model can actually choose them, and they don't quietly bloat every request's
context window.

mcplint checks name/schema validity, description quality, token weight, and safety
on destructive tools, then gives you a 0–100 score and a CI gate.

## Quick start

```bash
# install once, then use the short `mcplint` command shown below
npm install -g @tomfletcher2929/mcplint
mcplint tools.json

# or run it without installing:
npx @tomfletcher2929/mcplint tools.json
```

Lint a **static file** — a tools array, or an MCP `tools/list` result (`{ "tools": [...] }`):

```bash
mcplint tools.json                 # lint + score (free)
mcplint tools.json --ci --min 90   # exit 1 below 90 — drop into CI (free)
mcplint tools.json --json          # machine-readable
mcplint tools.json --report                 # shareable Markdown report (Pro)
mcplint tools.json --report --format html    # standalone HTML report (Pro)
mcplint tools.json --watch                   # re-lint on every save (Pro)
```

**Watch mode** (Pro) lints once, then re-lints and re-prints on every change
until you quit — pair it with `--report` to keep a report fresh, or `--json` to
pipe scores into a dashboard. A static file is watched for saves; a live server
has no file, so it's re-linted on a timer (`--interval <seconds>`, default 3):

```bash
mcplint tools.json --watch                          # re-lint the file on save
mcplint --cmd node --watch -- dist/server.js        # re-lint a live server every 3s
mcplint --cmd node --watch --interval 10 -- dist/server.js   # …every 10s
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

## Lint several sources at once (Pro)

Pass more than one source — files and/or one live `--cmd` server — to lint them
all in a single pass with a combined summary:

```bash
mcplint a.json b.json                              # several files
mcplint a.json b.json --cmd node --ci -- dist/server.js   # files + a live server, gated in CI
mcplint a.json b.json --json                       # one JSON object per source
```

Each source is scored independently and listed on its own row; `--ci` then fails
if **any** source breaches `--min` or has errors (a source that can't even be
linted counts as a failure — never a silent pass). `--report` and `--watch` act
on a single source, so run those one source at a time.

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

- **Free** (no key, always works): lint, score, `--json`, and the `--ci` gate — for a single file or a single live `--cmd` server.
- **Pro**: `--report` export (Markdown or `--format html`), watch mode, and the multi-source view (several sources in one pass). Set `MCPLINT_LICENSE_KEY`.

<!-- TODO(launch): replace LEMONSQUEEZY_STORE_URL below with the real checkout URL — see LEMONSQUEEZY-SETUP.md -->
**Get Pro:** [mcplint Pro](LEMONSQUEEZY_STORE_URL) — then `export MCPLINT_LICENSE_KEY=<your-key>`.

## Use as a library

```ts
import { lint, parseTools } from "@tomfletcher2929/mcplint";

const result = lint(parseTools(JSON.parse(rawJson)));
console.log(result.score, result.findings);
```

MIT-licensed engine. Automated linting catches structure and hygiene, not intent —
review findings in context.
