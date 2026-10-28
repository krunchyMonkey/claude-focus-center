# Claude Code handoff — after v0.1 merge

The MVP has already shipped into `main` through [PR #17](https://github.com/krunchyMonkey/claude-focus-center/pull/17). Issues #1–#13 are complete. **Do not run the original M0–M2 implementation loop again.**

## Read first

1. `CLAUDE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md` and `planning/PROGRESS.md`.
2. `docs/MVP-SPEC.md` and `docs/ARCHITECTURE.md` for the product contract.
3. GitHub [issue #14](https://github.com/krunchyMonkey/claude-focus-center/issues/14) (owner pilot) and [issue #18](https://github.com/krunchyMonkey/claude-focus-center/issues/18) (click-to-focus, with draft [PR #19](https://github.com/krunchyMonkey/claude-focus-center/pull/19)).

## Recommended prompt

```text
Read CLAUDE.md, docs/ROADMAP.md, docs/SECURITY.md and planning/PROGRESS.md.
The v0.1 MVP is already merged in PR #17. Do not reimplement issues #1-#13.
First, prepare a concise local pilot checklist for issue #14 and the click-through
validation for issue #18 / PR #19. Explain any live Claude session access,
global hook installation or credential changes before attempting them.
Do not read or publish my personal transcripts without my explicit consent.
Run verification on synthetic fixtures and record actual results.

Once the pilot is complete, present a go/no-go decision for v0.2. Do not
implement Candidate, Optional or Parked roadmap issues without my approval.
For authorized work, use issue-specific branches, tests, verifiable progress
checkpoints and draft PRs. Never auto-merge or publish.
```

## Daily pattern

- **Before coding:** check latest `main`, issues, branches and existing work; avoid duplicate implementation.
- **During:** take one committed issue, make the smallest valuable slice, run relevant tests, and record evidence.
- **After:** update `planning/PROGRESS.md` and the issue/PR with verification, remaining risk and owner decisions.
- **Stop:** permissions, paid services, transcript transmission, global hook changes, publishing, merging or enterprise adaptation require owner authorization.

This is a public personal repo. Keep organizational data and secrets completely out of source and fixtures.
