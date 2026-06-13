# mcplint — independent QA findings

Builders: fix BLOCKER/MAJOR items FIRST next session and mark them FIXED in place.

Reviewer's note: first hostile review against Tom's quality bar. **No BLOCKER
or MAJOR findings.** The untrusted-input path (the linter's whole job is
parsing arbitrary third-party MCP tool JSON) is genuinely robust: `parseTools`
rejects non-array/non-envelope input, non-object tools and non-string names
with a clear `McpLintError`; `description`/`inputSchema` are defensively
optional-typed; the CLI wraps every IO and parse path and exits with a clean
code 2; args are bounds-checked. The Pro licence gate (`src/pro/license.ts`) is
sound — `Boolean(data.valid)` is the authoritative LemonSqueezy flag, the new
revoked-status checks are correct defense-in-depth, and honouring an undefined
status with `valid:true` rightly avoids locking out a paying user on an
unexpected response shape. 22 tests green, CLI re-verified on the sample. Notes
only below.

## 2026-06-13

- **MINOR** — `src/cli.ts:67-72` — `lint(parseTools(JSON.parse(raw)))` runs in
  one try/catch where any non-`McpLintError` throw is reported as
  `Invalid JSON in <file>`. That's correct for a JSON syntax error, but a bug
  in a *rule* (`src/core/rules.ts`) processing a valid-but-adversarial
  `inputSchema` would surface as "Invalid JSON", wrongly blaming the customer's
  input for an internal defect and sending them down the wrong path. Fix:
  separate the `JSON.parse` step (→ "Invalid JSON") from the `parseTools`/`lint`
  step (→ "Could not lint <file>: <message>") so the two failure classes report
  distinctly.
- **NOTE (accepted posture, not a finding)** — `MCPLINT_DEV=1` unlocks Pro
  locally and is documented in public open-core source, so anyone reading the
  repo can unlock Pro free. This mirrors the a11ygent house pattern Tom blessed;
  perfect DRM on an open-core CLI is impossible and this is the deliberate
  trade-off. Recorded for awareness, not for action.
