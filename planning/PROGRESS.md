# Implementation checkpoint

This file is the durable handoff between Claude Code sessions. Record **verified facts**, not inferred work status. Update at the end of every scoped issue or meaningful interruption.

## Current checkpoint

- Date: 2026-10-26
- Current milestone: **M0 — Foundation**
- Last verified issue: **None; implementation not started**
- Next ready issue: **01-extension-scaffold**
- Other ready issue: **None** (all others depend on earlier work)
- Current branch / commit: **`feat/mvp` planned, not yet created; starter package only**
- Last executed verification: `python3 scripts/validate-plan.py` (planning integrity only)
- Known blockers: public GitHub repo created and specs seeded; local runtime not yet probed; local VS Code/Claude Code runtime not yet probed.

## Issue status table

| Issue | Status | Verified evidence | Branch / PR |
| --- | --- | --- | --- |
| 01-extension-scaffold | Not started | — | — |
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