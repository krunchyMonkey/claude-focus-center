# MVP Product Spec — Claude Focus Center

**Status:** Proposed v0.1  
**Target user:** A software engineer managing several Claude Code sessions across VS Code windows/repositories.  
**Product type:** Local-only VS Code desktop extension (no required paid API or hosted services).  
**Core outcome:** Within 30 seconds of opening VS Code, the engineer can identify the 1–3 items requiring their input and ignore the rest.

## Jobs to be done

- **Morning:** Tell me what needs my attention across recent sessions without reopening each conversation.
- **During work:** Tell me when a permission, decision, failure, or review actually needs me.
- **Cross-session:** Show related sessions as one workstream and expose any conflict in their reported state.
- **After interruption:** Tell me what changed since I last checked and where to resume.

## Primary user stories

1. As an engineer, I can discover sessions across at least three local repositories without manually configuring each project.
2. As an engineer, I see four groups: **Needs You**, **In Progress**, **Waiting**, **Resolved**, plus **Uncertain** for ambiguous cases.
3. As an engineer, I can see a compact evidence-backed reason for each attention item and its source session.
4. As an engineer, I can resume a selected local session in its original working directory.
5. As an engineer, I can acknowledge, snooze, resolve, and reopen an item; my choice survives a restart.
6. As an engineer, a notification or explicit Claude task can change the queue without my manually refreshing it.
7. As an engineer, I can get a delta since my last check without reading every transcript again.

## MVP interaction model

**Sidebar:** collapsible native Tree View grouped by attention status, then workstream. Show title, repo, stale/last activity, evidence indicator, and count. Keep status bar indicator optional; no interruptive popups except user-enabled actionable alerts.

**Details:** select an item to see "Why this needs you", "What changed", "Source session", and "Next step". Sources are local pointers; never invent a source link.

**Actions:** Resume in terminal, Open transcript excerpt (redacted if needed), Acknowledge, Snooze (e.g. 1 hour / until tomorrow), Mark Resolved, Reopen, Refresh, Catch Me Up, Enable/Disable hooks.

## Status and priority rules

| Status | Evidence examples | Notes |
| --- | --- | --- |
| Needs You | Permission request, explicit user decision, failed command requiring intervention, requested review | Highest priority; requires a next action |
| In Progress | Explicit task created / workstream active | Does not claim the agent process is currently executing |
| Waiting | Explicit external dependency or user-selected defer | Never inferred from silence alone |
| Resolved | User confirmed or reliable explicit task completion | Claude `Stop` alone does not resolve an item |
| Uncertain | Conflicting, missing, or ambiguous context | Expose uncertainty rather than auto-escalating |

Priority order: blocked permission > explicit decision / failure > requested review > informational update. Allow manual priority override. Show event age separately from status. Avoid inferring "working" just from a recent transcript timestamp.

## Cross-session grouping (MVP)

1. Exact work item reference (`AB#12345`, `#123`, explicit user-linked task) when namespace is known.
2. Same normalized repo root + git branch / worktree identity.
3. Manual `Link to workstream` override.
4. Otherwise leave separate, and optionally suggest likely related sessions.

Auto-merging related-looking descriptions across unrelated repositories is **out of scope**. A group retains individual session IDs and provenance.

## Nonfunctional acceptance

- Local sessions in at least 3 repositories discoverable on supported desktop OS.
- At least 10 local sessions ingest and render; incremental updates do not reread unchanged files.
- Hook event appears in the open dashboard within 5 seconds in normal local conditions.
- Restart retains triage state, evidence, and a recap checkpoint.
- Replaying an event or reloading a transcript creates no duplicate attention item.
- No external network requests or model calls by default; opt-in hooks preserve other Claude settings.
- No false claims of completion from `Stop` events, `SessionEnd`, or unverifiable assistant prose.
- Invalid JSONL and partial writes are handled without crash or busy loops.
- User can remove the extension's hook registrations without deleting unrelated hook configuration.
- Demo fixture includes at least 12 scenarios spanning permissions, decisions, failures, tasks, conflicting sessions, and completion.


## Personal pilot and enterprise separation

The personal pilot is built from a public personal repository using synthetic fixtures and permitted personal Claude sessions. Using personal Claude Code tokens **to develop the extension** does not authorize the extension to send any transcript content to a model. Runtime semantic classification stays opt-in and post-MVP. Employer-specific integrations and enterprise policies belong in a separate fork after approval; see [Enterprise fork](ENTERPRISE-FORK.md).

`CLAUDE.md` and [Claude build handoff](AGENT-KICKOFF.md) guide iterative implementation. The agent must checkpoint verified work in `planning/PROGRESS.md` after every issue so a new session can resume without re-reading the entire history.

## Runtime activity versus workstream state

**In Progress** means a workstream has unfinished work, not necessarily that a Claude process is currently running. Supported installations may optionally use `claude agents --json` for a separate, version-gated **Running Now** indicator. Failure to obtain that snapshot must never mark a task completed or blocked.

## Gold-path demo

Start VS Code with fixtures representing 4 projects and 10 sessions. Dashboard surfaces 2 Needs You items, 2 In Progress, 1 Waiting, 1 Uncertain. Start a hook fixture for a permission prompt: Needs You increments without a reload. Click an item to see evidence and resume the correct session. Acknowledge it and restart VS Code: its state persists. Replay the event: no duplicate. Press Catch Me Up: show only relevant changes since the checkpoint.

## MVP exit criteria

1. Primary workflow works end-to-end on a real macOS workstation with Claude Code installed.
2. A novice user can understand every item and resume the source in under 3 clicks.
3. Local data privacy requirements met and tested.
4. No critical status-correlation false positives in acceptance fixtures.
5. Install / uninstall / diagnostics documented with reproducible steps.

## Success measures (measure during pilot, not claims)

- Time to identify the next actionable task: target < 30 seconds.
- Reduction in manual session switching during a morning check-in: target >= 50%.
- Precision of "Needs You" alerts over a curated fixture set: target >= 90%.
- Duplicate attention records from deterministic replay: target 0.