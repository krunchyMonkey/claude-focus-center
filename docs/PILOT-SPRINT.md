# v0.1 Personal Pilot Sprint — 2026-10-29

**Repository:** [krunchyMonkey/claude-focus-center](https://github.com/krunchyMonkey/claude-focus-center). **Goal:** get the existing local-first VS Code MVP into a safe, owner-verified personal pilot. Core implementation #1–#13 shipped in merged PR #17. Don't build it again.

## Groomed work and order

| Order | Issue | Outcome | Eng. h | Owner h | Dependency |
|---|---|---|---:|---:|---|
| 1 | [#26](https://github.com/krunchyMonkey/claude-focus-center/issues/26) | Windows preflight, VSIX packaging, diagnostics | 3 | 0 | PR #17 |
| 2 | [#27](https://github.com/krunchyMonkey/claude-focus-center/issues/27) | Repeatable synthetic + human pilot walkthrough | 2 | 0 | PR #17 |
| 3 | [#28](https://github.com/krunchyMonkey/claude-focus-center/issues/28) | Local feedback scorecard and go/no-go rubric | 2 | 0 | #27 |
| Parallel | [#18](https://github.com/krunchyMonkey/claude-focus-center/issues/18), draft [PR #19](https://github.com/krunchyMonkey/claude-focus-center/pull/19) | Live session focus validation; **reuse existing implementation** | 1 | 1 | Owner click-through |
| Last | [#14](https://github.com/krunchyMonkey/claude-focus-center/issues/14) | **Owner's real-session acceptance gate** | 0 | 3 | #18 and #26–#28 |

**Total remaining estimate: 8 engineering hours + 4 owner-attention hours.** #14 is a parent acceptance gate; don't double-count child engineering estimates.

## Authorized Claude development

Implement #26, #27 and #28 using synthetic fixtures. Read `CLAUDE.md` and `docs/SECURITY.md`; use `docs/AGENT-KICKOFF.md` for the exact prompt. Review, do not re-create, PR #19 for #18. Create issue-scoped commits on a clean `feat/pilot-readiness` branch and one draft PR; never merge or publish without owner approval. Keep `planning/PROGRESS.md` current with real test results.

**Before cloning or branching:** inspect `git remote -v`, `git status -sb`, `git worktree list --porcelain`, existing branch and PR. Reuse the matching worktree. Only clone/create a new worktree when none already exists; never destroy dirty work.

## Required safety boundary

- No inspection or upload of real personal Claude transcripts by the coding agent; no proprietary/employer code or credentials in this public repo.
- No global hook installation, user-profile VSIX installation, API-key use, network telemetry, or paid inference without explicit owner action.
- Don't use permission bypass, infer completion from a Claude Stop event, close #14/#18 based on synthetic tests, or take on #15/#16/#20–#25.

## Exit criteria

**Agent ready:** #26–#28 pass scoped tests, with honest results and draft PR; #18/PR #19 has a clear manual check. **Owner pilot accepted:** owner actually installs/tests against consented personal sessions, verifies navigation and correct attention/triage/restart behavior, reviews privacy controls, records misses/false positives, and signs off Go / Go with limitations / No-go in #14.

See [ROADMAP.md](ROADMAP.md) for choices beyond the pilot.
