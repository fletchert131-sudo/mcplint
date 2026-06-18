#!/bin/bash
# SessionStart hook — memory alignment + orientation (NOT a dependency hook).
# 1) fast-forward to the latest committed memory on the working branch (never clobbers local work)
# 2) print the operating contract + this repo's STATE.md so the session is oriented with zero prompting.
set -uo pipefail

BRANCH="claude/github-repos-access-3p49ni"
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

git -C "$DIR" pull --ff-only origin "$BRANCH" >/dev/null 2>&1 || true

cat <<'CONTRACT'
=== OPERATING CONTRACT (auto-loaded — read before acting) ===
- Direct-first: propose ONE recommended plan, get Tom's approval, then run it to done or a genuine blocker.
- Session loop: memory was just pulled; READ ./STATE.md below; when done, update ./STATE.md + commit + push to the working branch.
- Self-learning is paramount + MONEY GATE: improve the machine yourself (don't make Tom research/prompt); every change must make the machine better AND raise revenue odds — no busywork.
- Priority: (1) the machine (agents/skills/memory-OS/orchestration) (2) refit/design (3) revenue.
- Full operating system lives in brain-dump: SYSTEM.md (pillars, machine standards, the loop), DECISIONS.md (durable decisions), MACHINE-UPGRADES.md (ranked upgrades), SKILLS-POLICY.md, PORTFOLIO.md. READ brain-dump/SYSTEM.md before proposing work.
CONTRACT

if [ -f "$DIR/STATE.md" ]; then
  echo
  echo "=== ./STATE.md — where we left off ==="
  cat "$DIR/STATE.md"
fi
exit 0
