#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PROMPT="Read CLAUDE.md, docs/AGENT-KICKOFF.md, docs/MVP-SPEC.md, docs/SECURITY.md, and planning/PROGRESS.md. Implement issue #1 first, then the dependency-ready MVP issues. Verify each slice, checkpoint progress, and commit on feat/mvp. Stop for permissions, company data, secrets, external services, merging, and publishing."
case "${1:---interactive}" in
  --dry-run) printf '%s\n' "$PROMPT" ;;
  --interactive) exec claude "$PROMPT" ;;
  --background) exec claude --bg "$PROMPT" ;;
  *) echo "Use --dry-run, --interactive or --background" >&2; exit 2 ;;
esac
