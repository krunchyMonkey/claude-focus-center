#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROMPT="Only work in krunchyMonkey/claude-focus-center. Read CLAUDE.md, docs/PILOT-SPRINT.md, docs/AGENT-KICKOFF.md and docs/SECURITY.md. Check worktrees before cloning. Implement groomed issues #26, #27, #28 in order using synthetic fixtures and issue-scoped commits on feat/pilot-readiness. Use existing PR #19 for #18; do not recreate it. Issue #14 requires owner sign-off. Do not merge, publish, install global hooks or inspect unapproved personal transcripts."
case "${1:---interactive}" in
  --dry-run) printf '%s\n' "$PROMPT" ;;
  --interactive) exec claude "$PROMPT" ;;
  --background) exec claude --bg "$PROMPT" ;;
  *) echo "Use --dry-run, --interactive or --background" >&2; exit 2 ;;
esac
