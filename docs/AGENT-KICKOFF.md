# Claude Code handoff — v0.1 personal pilot readiness

Target **only** [krunchyMonkey/claude-focus-center](https://github.com/krunchyMonkey/claude-focus-center). The core MVP (#1–#13) is already merged in PR #17. This is not a request to rebuild it.

## Copy-ready kickoff

```text
Work only in https://github.com/krunchyMonkey/claude-focus-center.

Inspect the current git remote, branch, dirty working tree, existing
worktrees and open PRs BEFORE modifying anything. Reuse a matching worktree
for the pilot branch or issue. Only create a worktree/clone if there is no
existing suitable checkout; never overwrite a dirty tree.

Read CLAUDE.md, docs/PILOT-SPRINT.md, docs/SECURITY.md,
docs/ROADMAP.md and planning/PROGRESS.md. MVP #1-#13 is already merged
in PR #17; do not reimplement those issues.

Start implementation in this order:
  #26 - Windows pilot preflight, packaging and diagnostics
  #27 - synthetic + owner-run pilot walkthrough
  #28 - local-only pilot scorecard (after #27)

Use one clean feat/pilot-readiness integration branch from fresh origin/main
or reuse an existing matching worktree. Do one scoped commit and record actual
tests/results for each issue, update planning/PROGRESS.md and its GitHub issue,
then open/update ONE draft PR. Do not merge.

Separately inspect issue #18 and existing draft PR #19. Do not create
a duplicate PR or implementation. Only targeted changes/review there.
The owner must manually test real click-to-focus behavior.

Issue #14 is the OWNER acceptance gate. Do not mark it complete or claim
real personal Claude sessions were tested. Prepare clear instructions for
the owner, and stop once all agent-ready preparation is verified.

No unapproved reading of personal transcripts, proprietary work data,
global Claude settings/hook changes, installation into the owner's real
VS Code profile, paid APIs, credentials, telemetry, publication or
permission-bypass. Use synthetic fixtures and approved normal tests.
Do not begin #15-#16 or #20-#25 without new owner approval.

At handoff list each issue, commit/PR, exact test outputs, residual risks,
and the specific actions needed from the owner.
```

## What to build and what to leave to the owner

Claude can build a preflight script, write the runbook, run fixture tests, produce a privacy-safe scoring template, review existing PR #19, and prepare draft PRs. Only the **owner** can opt into global hooks, install into their primary VS Code profile, inspect actual personal conversations, verify live-session behavior, and approve closing #14/#18.

The dependency chain and remaining-hour estimates are in [PILOT-SPRINT.md](PILOT-SPRINT.md). No automatic publishing, merging or organization-specific integration.
