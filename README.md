# Claude Focus Center

**Know what needs your attention across Claude Code sessions—without managing another task list.**

A planned local-first VS Code extension that turns activity across multiple Claude Code sessions, repositories, and worktrees into a concise attention queue.

> **Project status (2026-10-26):** implementation-ready specification and Claude Code handoff in the public [GitHub repository](https://github.com/krunchyMonkey/claude-focus-center). Implementation is in progress on the `feat/mvp` branch; the Focus Center view with Refresh/Diagnostics and read-only local session discovery builds and passes its tests. See [planning/PROGRESS.md](planning/PROGRESS.md).

## The problem

Claude Code can operate across many concurrent conversations. As work moves between sessions, it becomes difficult to know which decisions, reviews, failures, and blockers need human attention versus what can be safely ignored. Claude Focus Center is an **attention layer**, not another chat UI or a project-management system.

## MVP experience

1. Open VS Code. Focus Center discovers existing local Claude Code sessions across projects.
2. Its sidebar shows **Needs You**, **In Progress**, **Waiting**, and **Resolved** workstreams, each linked to source evidence.
3. During the day, Claude Code hooks provide new high-signal events; the queue updates without manually tracking tasks.
4. Select an item to see why it is surfaced and resume the relevant session via an integrated terminal.
5. Click **Catch Me Up** for changes since the previous checkpoint; acknowledge or snooze noisy items.

### MVP principles

- **Actionability over activity:** do not notify for every tool call.
- **Evidence over confidence theater:** every action links to a session/message/hook event; ambiguity remains visible.
- **Safe by default:** local storage, read-only transcript access, no background transmission of source material.
- **Conservative resolution:** a Claude `Stop` event is not proof that implementation or testing is complete.
- **Multiple sessions, one workstream:** group by explicit work-item identifier or repo+branch; suggest uncertain merges rather than applying them automatically.

## MVP included

- Local session discovery and incremental ingestion (macOS/Linux initially)
- User-opt-in Claude Code hook collection for sessions, notifications, explicit tasks, stop/failure
- Normalized session and attention state, conservative rule-based extraction
- Native VS Code Tree View with priority grouping and evidence details
- Manual actions: resume, acknowledge, snooze, mark resolved, reopen
- Workstream grouping by explicit references and repository/branch
- Catch Me Up recap from locally recorded state changes
- Restart-safe local storage and fixtures-based tests

## Explicitly deferred

- Cloud-only Claude sessions and cross-device synchronization
- Automatic AI summarization of full transcripts or automatic uploads to external models
- Automatic semantic merging across unrelated repositories
- Slack, Linear, Azure DevOps, Jira, or GitHub API integrations
- Auto-approving permissions, auto-closing issues, or acting on Claude's behalf
- Multi-user collaboration and analytics dashboards

## Build and test

Requirements: Node.js 20+ and npm; VS Code 1.100 or later. No API key, model or network service is needed at runtime.

```bash
npm install              # dev dependencies only (TypeScript, VS Code test runner)
npm run compile          # TypeScript -> out/
npm run typecheck        # tsc --noEmit
npm run test:unit        # pure-logic tests with node:test
npm run test:host        # Extension Development Host tests
npm test                 # both
```

`npm run test:host` downloads VS Code 1.100.0 (the supported minimum) into `.vscode-test/` on first run. To use an installed VS Code instead, set `FOCUS_CENTER_VSCODE_EXE` to its executable path (VS Code must not be mid-update). The runner clears `ELECTRON_RUN_AS_NODE` so it also works from a VS Code integrated terminal.

**Try it:** open this folder in VS Code and press <kbd>F5</kbd> ("Run Extension"). In the Extension Development Host, open the **Focus Center** activity-bar icon. The Attention Queue groups items as **Needs You** (always shown; it says so when empty), **In Progress**, **Waiting**, **Uncertain** and **Resolved** (collapsed), then by workstream. Each item shows its repo, age, whether its evidence is *direct* or *inferred*, and an evidence count. Hover an item for why it is there, the next step and its source session. The view badge counts Needs You items. **All sessions** (collapsed) lists every discovered session. The view is a native tree: it works with the keyboard and high-contrast themes, and you can drag it to the secondary side bar. Refresh and Show Diagnostics are on the view toolbar and in the Command Palette under "Focus Center".

**Triage.** Acknowledge (I've seen it), Snooze (1 hour, 4 hours or until 09:00 tomorrow; the item moves to *Waiting* and comes back on its own), Mark Resolved and Reopen are on each item's context menu, with inline buttons for the common ones. They are stored in Focus Center's own state, never in Claude's files, and survive restarts. Newer blocking evidence, such as Claude raising the same permission prompt again, supersedes an earlier acknowledgement, snooze or resolution, and the item returns to Needs You.

**Details and resume.** Click an item, or press Enter on it, to open a read-only details document: *why it is here* (each piece of evidence with time, source and redacted excerpt), *what changed*, the *source session* and the *next step*. **Resume Session in Terminal** (the inline terminal icon or the context menu) opens an integrated terminal in the session's original working directory running `claude --resume <session-id>`. The CLI is the terminal's own process, started with an argument list, so no shell command is built from session data. Session IDs are checked against a strict character set, a missing working directory or CLI is reported with a copyable command, and a missing transcript asks first. Set `focusCenter.claudePath` if `claude` is not on `PATH`. Resume starts the session; it does not focus a terminal where that session is already running. Diagnostics writes a local health report to the *Focus Center* output channel and never claims full coverage while sources are missing.

### What it reads

- Session root: `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`). Only the 200 most recently modified `<project>/<session>.jsonl` files are considered, and only their first 64 KB is parsed to find the working directory and git branch. No message content is kept. Transcripts are never modified.
- `focusCenter.excludedPaths` (user setting): project folders that are skipped **before** any of their transcripts is opened. A path also excludes subfolders and `~` expands to your home folder. Because Claude's folder naming is lossy, matching errs towards excluding more.

### Optional Claude Code hooks

Hooks are **off by default**. **Focus Center: Enable Claude Hooks…** (Command Palette or the view's `…` menu) shows exactly what will change and asks for confirmation. Then it:

- copies the dependency-free hook script to Focus Center's global storage (a stable path that does not change with extension updates);
- backs up `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) into Focus Center's storage under `backups/`;
- adds one `async` exec-form command hook (`node <script> <Event> <spool dir>`, no shell) for SessionStart, UserPromptSubmit, Notification, PermissionRequest, PostToolUseFailure, TaskCreated, TaskCompleted, Stop, StopFailure and SessionEnd. Async hooks cannot block Claude or approve or deny anything.

Existing settings and other hooks are kept. If the settings file is not valid JSON, or changes while it is being updated, nothing is written. **Focus Center: Disable Claude Hooks…** removes only entries whose arguments reference `claude-focus-center-hook.js`. Node.js must be on `PATH`, or set `focusCenter.hooks.nodePath`.

Each hook run writes one small JSON file into Focus Center's `spool/` folder (written to a temp name, then renamed) and exits 0 with no output. It keeps only the event name, session ID, cwd, transcript path and a few minimal fields: tool name, notification type, task ID and subject, error type, and short redacted excerpts of notification messages, failing commands' first lines and Claude's last message. Tool inputs and prompts are never written. The extension watches the spool, falling back to a rescan every 2.5 s, and drops duplicate deliveries. Spool files are deleted after 7 days.

## Documents

| Document | Purpose |
| --- | --- |
| [Product / MVP spec](docs/MVP-SPEC.md) | Users, scope, UX, acceptance criteria, demo |
| [Daily workflow](docs/USER-WORKFLOW.md) | Visual user journey and states |
| [Architecture](docs/ARCHITECTURE.md) | Collectors, normalization, storage, UI, contracts |
| [Security](docs/SECURITY.md) | Privacy boundaries, hooks, safeguards |
| [Delivery plan](docs/DELIVERY-PLAN.md) | Milestones, sequencing, definition of done |
| [Technical decisions](docs/DECISIONS.md) | ADRs and intentionally deferred decisions |
| [GitHub Project notes](docs/PROJECT-BOARD.md) | How the board is arranged |
| [Issue index](planning/issue-index.tsv) | Importable MVP backlog |
| [Claude build handoff](docs/AGENT-KICKOFF.md) | Paste-ready autonomous implementation prompt, background launch, stop conditions |
| [Implementation contracts](docs/IMPLEMENTATION-CONTRACTS.md) | Module boundaries, normalization, deduplication, tests |
| [Agent progress](planning/PROGRESS.md) | Persistent checkpoints between Claude Code sessions |
| [Enterprise fork](docs/ENTERPRISE-FORK.md) | Planned separation of personal and approved organization adapters |

## GitHub issues and optional Project board

This repository is already public at [`krunchyMonkey/claude-focus-center`](https://github.com/krunchyMonkey/claude-focus-center). Specifications live in `docs/` and the 16 implementation issues are tracked in [GitHub Issues](https://github.com/krunchyMonkey/claude-focus-center/issues). The 14 MVP issues are grouped into M0, M1, and M2; issues 15-16 are post-MVP.

GitHub Issues is the source of truth for the MVP backlog. A GitHub Projects board can be added later through the GitHub UI; it is not required to start implementing. No repository bootstrap is needed.

## Hand off implementation to your personal Claude Code

Clone the public personal repository into a dedicated folder and open it in VS Code. `CLAUDE.md` is the standing project instruction file and `docs/AGENT-KICKOFF.md` contains a detailed build prompt. For supported Claude Code versions, you can launch a background implementation session:

```bash
./scripts/start-personal-build.sh --dry-run      # preview exactly what it asks
./scripts/start-personal-build.sh --background   # run on your machine
claude agents                                    # inspect agents
```

Or run `./scripts/start-personal-build.sh --interactive` if you prefer normal supervision. **No model inference or API tokens are needed by the extension at runtime for v0.1.** Your personal Claude Code account is used only for development. Never include work data or credentials in the personal repo; see `docs/ENTERPRISE-FORK.md`.

The first user-visible slice should show an empty native Tree View in an Extension Development Host, then recent local session metadata. Read `docs/SECURITY.md` before adding transcript ingestion or hooks.


## References

- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [VS Code view UX guidelines](https://code.visualstudio.com/api/ux-guidelines/views)
