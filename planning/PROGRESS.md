# Implementation checkpoint

This file is the durable handoff between Claude Code sessions. Record **verified facts**, not inferred work status. Update at the end of every scoped issue or meaningful interruption.

## Current checkpoint

- Date: 2026-10-26
- Current milestone: **M0 — Foundation**
- Last verified issue: **01-extension-scaffold** (GitHub #1)
- Next ready issue: **02-session-discovery** (also dependency-ready: 04-hook-config, 06-state-model)
- Current branch / commit: **`feat/mvp`** (local only; not pushed, no draft PR — awaiting owner approval)
- Last executed verification: clean `npm ci` + `npm run typecheck` + `npm test` (4/4 unit, 5/5 extension-host on VS Code 1.100.0)
- Known blockers: none for M0. See "Environment notes" for platform differences and doc gaps.

## Environment notes (probed 2026-10-26)

- OS: **Windows 11 Pro x64** (docs assume macOS first; Windows is the actual dev machine). Shell: Git Bash / PowerShell.
- Node v25.0.0, npm 11.6.2, VS Code 1.142.0 (an update was staged, which blocked launching the installed build for tests).
- Toolchain chosen: TypeScript 7.0.2 (`tsc`), `@types/vscode` 1.100.0 (engines `^1.100.0`), `@types/node` 22.20.5, `@vscode/test-electron` 3.1.0. No runtime dependencies.
- `claude` CLI is **not on PATH** in this environment; resume (issue 10) must detect and report a missing CLI.
- Claude session root exists at `%USERPROFILE%\.claude\projects` (contents not inspected by the agent; tests use synthetic fixtures only).
- `ELECTRON_RUN_AS_NODE=1` is inherited from VS Code terminals; the host-test runner clears it.
- Doc gaps: `scripts/validate-plan.py` and `planning/issues/*.md` referenced by CLAUDE.md/AGENT-KICKOFF.md do not exist — GitHub issues #1–#16 are the acceptance source. `docs/DECISIONS.md` currently duplicates `docs/DELIVERY-PLAN.md`; `docs/USER-WORKFLOW.md` linked from README is missing.

## Issue status table

| Issue | Status | Verified evidence | Branch / PR |
| --- | --- | --- | --- |
| 01-extension-scaffold | Verified | typecheck; 4/4 unit; 5/5 host tests (VS Code 1.100.0) | `feat/mvp` (local) |
| 02-session-discovery | Not started | — | — |
| 03-incremental-reader | Not started | — | — |
| 04-hook-config | Not started | — | — |
| 05-event-ingestion | Not started | — | — |
| 06-state-model | Not started | — | — |
| 07-attention-rules | Not started | — | — |
| 08-workstream-grouping | Not started | — | — |
| 09-sidebar | Not started | — | — |
| 10-resume-details | Not started | — | — |
| 11-triage-controls | Not started | — | — |
| 12-catch-me-up | Not started | — | — |
| 13-privacy-controls | Not started | — | — |
| 14-acceptance-qa | Not started | — | — |

## Checkpoints

### 2026-10-26 — Issue 01 / Extension scaffold and native Focus Center view
- Status: Verified (automated); visual F5 walk-through by the owner still recommended.
- Branch / commit / draft PR: `feat/mvp`, commit "feat(01): scaffold extension…"; not pushed, no PR.
- Changed: `package.json` (activity-bar container, `focusCenter.queue` tree view, welcome content, Refresh/Show Diagnostics commands + view title buttons), `tsconfig.json`, `src/extension.ts` (wiring only), `src/ui/focusTreeProvider.ts` (native `TreeDataProvider`, empty roots), `src/diagnostics/report.ts` (pure report; never claims full coverage), tests under `src/test/`, `media/focus-center.svg`, `.vscode/launch.json` + `tasks.json` (F5), `.vscodeignore`, README "Build and test", CI `build` job (typecheck + unit tests).
- Checks actually run (command + result):
  - `rm -rf node_modules out && npm ci` → 0 vulnerabilities.
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 4 pass, 0 fail.
  - `npm run test:host` (downloaded VS Code 1.100.0, `--disable-extensions`, fresh user-data dir) → 5/5: activates with empty queue; both commands registered; Refresh runs with no sessions; Diagnostics reports partial coverage; `focusCenter.queue.focus` reveals the view. Exit 0.
  - Same suite against installed VS Code 1.142 → **not run**: "Code is currently being updated" (staged update).
- Manual smoke test: not performed visually by the agent (no screen access). To check: F5 → Focus Center icon → empty queue with Refresh / Show Diagnostics.
- What is still unverified: rendering on VS Code 1.142; macOS/Linux; moving the view to the secondary sidebar (issue 09); CI `build` job has not run (branch not pushed).
- Next ready issue: 02-session-discovery.
- Decision or permission needed: approval to push `feat/mvp` / open a draft PR (repo is public).

## Checkpoint template (copy for each completed issue)

```markdown
### YYYY-MM-DD — Issue 0X / short title
- Status: Verified | Partial | Blocked
- Branch / commit / draft PR: ...
- Changed: ...
- Checks actually run (command + result): ...
- Manual smoke test: ...
- What is still unverified: ...
- Next ready issue: ...
- Decision or permission needed, if any: ...
```

## Release gates

- [ ] VS Code Extension Development Host launches with Focus Center view.
- [ ] Local multi-repo session discovery works without real transcript fixtures committed.
- [ ] Opt-in hooks are reversible and non-blocking.
- [ ] Needs You evidence is accurate; `Stop` is not treated as completion.
- [ ] All triage actions and Catch Me Up survive extension restart.
- [ ] VSIX installation, privacy cleanup, and synthetic acceptance suite pass.

Do not mark any release gate complete without recording how it was verified.