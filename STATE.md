# mcplint — STATE (where we left off)

> **Working memory** for cross-device sessions (laptop · phone · nightly). Read FIRST,
> resume from "Next actions"; UPDATE and push LAST. Durable rules/architecture live in
> CLAUDE.md; this is the volatile "what's happening now" layer.
> **Session loop:** start → `git pull`, read STATE → work → update STATE → `git commit && git push`.

## Goal
- **What:** open-core CLI + library that lints & scores MCP server tool definitions.
- **Money:** open-core funnel — free lint/score/CI/live `--cmd`; paid Pro = report export + watch mode. (LemonSqueezy licence, no price set in repo yet.)
- **Needs-human-setup-ready =** code shipped + tested, then only Tom's launch steps: stand up the LemonSqueezy store, `npm publish`, and list on MCP registries.
- **Kill rule:** none written in CLAUDE.md (built as the agent-setup proving venture vs the Fable benchmark).

**Status:** v0 shipped; roadmap item 1 (live-server linting) done · last touched 2026-06-18

## Where we left off
- v0 engine shipped: pure `src/core/*` (types, rules, score, lint) + CLI + library API.
- Roadmap 1 DONE (2026-06-15): live-server linting over stdio — `--cmd <server> [-- <args>]`
  spawns an MCP server, runs initialize + tools/list, lints the result (`src/connect/stdio.ts`).
- Two independent QA review passes filed (13 Jun); licence status check tightened.
- Latest commit (18 Jun) was docs-only: vendored Karpathy guardrails (KARPATHY.md).
- Tests run with no network/API key (live tests use a local fixture server). `npm test` green is the bar.

## Next actions (do these next)
1. Roadmap 2 — HTML report export (`--report` is Markdown-only today; add HTML).
2. Roadmap 3 — watch mode + multi-server view (Pro).
3. Roadmap 4 — expose mcplint itself as an MCP server (dogfood).
4. Roadmap 5 — provider abstraction so the licence store is a config switch (LemonSqueezy/Gumroad).
- Guard the invariants on every change: free tier always works, never `shell: true`,
  name-format follows the MCP spec (kebab-case is valid), server flags after `--`.

## Open / waiting on Tom (human-only)
- Stand up the LemonSqueezy store + product, then wire the upgrade URL.
- `npm publish` the package.
- List on the MCP registries (PulseMCP, Glama, mcp.directory, official registry).

## Session log (newest first)
- 2026-06-18 — STATE.md created (cross-device memory system set up).
- 2026-06-18 — docs: vendored Karpathy CLAUDE.md guardrails + wired @import.
- 2026-06-15 — feat: live-server linting over stdio (roadmap 1).
- 2026-06-13 — two independent QA review passes; tightened licence status check.
- 2026-06-13 — mcplint v0 shipped (open-core MCP tool-definition linter).
