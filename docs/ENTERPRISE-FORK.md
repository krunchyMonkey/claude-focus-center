# Claude Code build handoff

This is the **single entry point** for a personal Claude Code instance building Claude Focus Center. The repo's `CLAUDE.md` contains standing rules; this page provides the first prompt, execution loop and checkpoints.

## Where the project stands

- **Status:** planning complete; no implemented extension has been verified yet.
- **Environment:** private personal GitHub repository, local macOS VS Code desktop first.
- **Work item:** start with `planning/issues/01-extension-scaffold.md` (M0).
- **Scope:** build the personal MVP. Do not implement organization-specific integrations, remote collaboration, or paid AI classification yet.
- **Permission boundary:** normal development edits, tests and local feature-branch commits are in scope. No auto-merge, publishing, paid services, global settings changes, or permission bypass.

## First checkout

1. Clone or open `krunchyMonkey/claude-focus-center` in VS Code. Confirm you are in **this** repository, not a work organization checkout.
2. Run `python3 scripts/validate-plan.py` and read `CLAUDE.md`, `docs/MVP-SPEC.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DELIVERY-PLAN.md`, `planning/PROGRESS.md`.
3. Inspect `git status` and recent commits. If the working tree contains user changes, don't overwrite them; create your own branch when safe.
4. Verify installed `node`, `npm`, `code`, and `claude`. Choose dependency versions compatible with the locally installed tooling; document them before building.

## Copy/paste prompt for Claude

```text
You are the implementing engineer for Claude Focus Center in this repository.
Read CLAUDE.md, docs/MVP-SPEC.md, docs/ARCHITECTURE.md,
docs/SECURITY.md, docs/AGENT-KICKOFF.md, docs/DELIVERY-PLAN.md,
planning/issue-index.tsv, and planning/PROGRESS.md.

Goal: build the v0.1 personal MVP, starting with the lowest-numbered ready
P0 issue. Implement one verifiable vertical slice at a time. Use the acceptance
criteria in planning/issues/ as the contract, and keep implementation as small
and maintainable as possible. Work independently through ready issues while
the current session is authorized to continue, with checkpoints after each.

For each issue: inspect current repo state; briefly note approach; create a
focused feature branch; implement code and synthetic tests; run relevant
checks; update planning/PROGRESS.md with exactly what passed and what did not;
commit locally. If the authenticated personal repo remote is configured, you
may push and open a draft PR. Do not merge or publish, modify global Claude
settings, transmit real transcripts, introduce paid services, or use permission
bypass. Do not use personal credentials for proprietary company data.

If a decision, authorization, incompatibility, security concern or missing
resource prevents safe progress, stop and report one concise actionable
question plus the evidence. Otherwise continue to the next ready P0 slice.
Start with 01-extension-scaffold. Show the first observable demo as soon as
it builds in the VS Code Extension Development Host.
```

## Start the implementation session

Recommended interactive start (works even without background-agent support):

```bash
cd /path/to/claude-focus-center
claude
# Paste the prompt above.
```

On Claude Code versions supporting background agents, from this repo root:

```bash
claude --bg "Read CLAUDE.md and docs/AGENT-KICKOFF.md. Follow the copy/paste prompt under 'Copy/paste prompt for Claude', starting with issue 01. Work through ready P0 issues with tests and checkpoints; stop at safety/permission gates."
claude agents
# To inspect agent output by ID, use: claude logs <id>
```

`claude --bg` is a feature of the **user's local Claude Code**, not a promise that ChatGPT keeps working. Permissions, cost limits or session settings may pause a background agent. Do not add `--dangerously-skip-permissions` to work around those gates. Check `claude --help` / the official CLI documentation for version compatibility.

## Build cadence and accountability

For each issue, produce:

- **Change:** paths/files touched and intended behavior.
- **Evidence:** exact build, test, typecheck, or manual smoke-check commands and results.
- **Status:** verified, partial, blocked, or not started. A green claim without actual execution is not verified.
- **Handoff:** branch/commit/PR when present, one concrete next action and any risk.

Use `planning/PROGRESS.md` as the persistent handoff so a fresh Claude session can continue after compaction. Do not infer that a background session is still running from a stale transcript timestamp.

## Stop conditions

Stop and ask the user instead of guessing when: credentials or API keys are needed; global Claude hooks or settings would be changed; real session data must be inspected; a third-party API or model would receive content; a feature requires a paid service; a destructive Git action is proposed; repository visibility, publication or installation scope changes; or an architecture decision would contradict the MVP spec.

If GitHub isn't available, continue locally. Do not modify a similarly named, unrelated repository as a substitute.

## References

- Claude Code CLI: https://code.claude.com/docs/en/cli-reference
- Hooks: https://code.claude.com/docs/en/hooks
- VS Code Tree View API: https://code.visualstudio.com/api/extension-guides/tree-view