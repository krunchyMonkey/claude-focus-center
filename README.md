# Claude Focus Center

**Know what needs your attention across Claude Code sessions—without managing another task list.**

A local-first VS Code extension that turns activity across multiple Claude Code sessions, repositories, and worktrees into a concise attention queue.

> **Project status (2026-10-28):** v0.1 MVP merged in [PR #17](https://github.com/krunchyMonkey/claude-focus-center/pull/17). Automated tests passed; the owner still needs to run a real-session pilot ([#14](https://github.com/krunchyMonkey/claude-focus-center/issues/14)) and manual live-session navigation review ([#18](https://github.com/krunchyMonkey/claude-focus-center/issues/18), draft [PR #19](https://github.com/krunchyMonkey/claude-focus-center/pull/19)). See [Roadmap & investment options](docs/ROADMAP.md).

## Choose how far to take it

See [Roadmap: pilot, reliability, optional Marketplace beta](docs/ROADMAP.md) for estimates, decision gates and proposed time windows. [Create a repository-linked GitHub Projects roadmap](docs/PROJECT-BOARD.md) using `bash scripts/create-project-board.sh` after `gh auth refresh -s project`.

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
npm install              # dev dependencies only (TypeScript, VS Code test runner, vsce)
npm run compile          # TypeScript -> out/
npm run typecheck        # tsc --noEmit
npm run test:unit        # pure-logic tests with node:test (includes 20 curated attention scenarios)
npm run test:host        # Extension Development Host tests
npm run test:acceptance  # gold-path daily workflow across two VS Code launches (restart)
npm test                 # unit + host + acceptance
npm run package          # builds focus-center.vsix (no runtime dependencies)
npm run test:vsix        # packages, installs into an isolated folder, smoke-tests the installed copy
```

To install the package in your own VS Code: `code --install-extension focus-center.vsix`. The test scripts never install into your profile; they use temporary user-data and extension folders.

The host, acceptance and VSIX tests download VS Code 1.100.0 (the supported minimum) into `.vscode-test/` on first run. To use an installed VS Code instead, set `FOCUS_CENTER_VSCODE_EXE` to its executable path (VS Code must not be mid-update). The runner clears `ELECTRON_RUN_AS_NODE` so it also works from a VS Code integrated terminal.

**Try it:** open this folder in VS Code and press <kbd>F5</kbd> ("Run Extension"). In the Extension Development Host, open the **Focus Center** activity-bar icon. The Attention Queue groups items as **Needs You** (always shown; it says so when empty), **In Progress**, **Waiting**, **Uncertain** and **Resolved** (collapsed), then by workstream. Each item shows its repo, age, whether its evidence is *direct* or *inferred*, and an evidence count. Hover an item for why it is there, the next step and its source session. The view badge counts Needs You items. **All sessions** (collapsed) lists every discovered session. The view is a native tree: it works with the keyboard and high-contrast themes, and you can drag it to the secondary side bar. Refresh and Show Diagnostics are on the view toolbar and in the Command Palette under "Focus Center".

**Triage.** Acknowledge (I've seen it), Snooze (1 hour, 4 hours or until 09:00 tomorrow; the item moves to *Waiting* and comes back on its own), Mark Resolved and Reopen are on each item's context menu, with inline buttons for the common ones. They are stored in Focus Center's own state, never in Claude's files, and survive restarts. Newer blocking evidence, such as Claude raising the same permission prompt again, supersedes an earlier acknowledgement, snooze or resolution, and the item returns to Needs You.

**Catch Me Up.** The history button on the view toolbar opens a recap of what changed since your last check. It is built only from Focus Center's local change journal, with no model or network call. Changes are grouped as *Needs you now*, *Resolved since your last check*, *Other changes* and *New sessions*. Your own triage actions are counted, not listed. If nothing changed, it says so. **Mark Caught Up** moves the checkpoint to the end of the recap you saw, so changes that arrived while you were reading appear next time. The checkpoint survives restarts.

**Details and resume.** Click an item, or press Enter on it, to open a read-only details document: *why it is here* (each piece of evidence with time, source and redacted excerpt), *what changed*, the *source session* and the *next step*. **Resume Session in Terminal** (the inline terminal icon or the context menu) opens an integrated terminal in the session's original working directory running `claude --resume <session-id>`. The CLI is the terminal's own process, started with an argument list, so no shell command is built from session data. Session IDs are checked against a strict character set, a missing working directory or CLI is reported with a copyable command, and a missing transcript asks first. Set `focusCenter.claudePath` if `claude` is not on `PATH`. Resume starts the session; it does not focus a terminal where that session is already running. Diagnostics writes a local health report to the *Focus Center* output channel and never claims full coverage while sources are missing.

### What it reads

- Session root: `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`). Only the 200 most recently modified `<project>/<session>.jsonl` files are considered, and only their first 64 KB is parsed to find the working directory and git branch. No message content is kept. Transcripts are never modified.
- `focusCenter.excludedPaths` (user setting): project folders that are skipped **before** any of their transcripts is opened. A path also excludes subfolders and `~` expands to your home folder. Because Claude's folder naming is lossy, matching errs towards excluding more.

### Privacy controls

- **Scope.** `focusCenter.excludedPaths` lists projects that are never read or recorded. `focusCenter.includedPaths` is an optional allow-list; when it is set, only those projects are monitored. Both apply to session discovery *and* to hooks: the hook script reads the same scope and writes nothing for out-of-scope projects, and the extension filters again. The scope fails closed: if the hook's scope file is missing or unreadable it records nothing, and an event whose project is unknown (no or over-long `cwd`) is dropped whenever any exclusion or allow-list is set. Changing either setting also deletes anything already stored for projects that fall out of scope: saved state, spool records, read positions and dedupe ids. The saved snapshot and its backup are rewritten without that data. Recovered copies that Focus Center sets aside after corruption (`state.json.corrupt-…`) are only removed by **Delete Focus Center Data**.
- **Pause.** **Focus Center: Pause Monitoring** stops all reading and recording, including by hooks, until you resume. Pausing does not delete data.
- **Where data lives.** Focus Center's state, hook spool and settings backups are in VS Code's global storage for this extension. The exact path is shown in **Show Diagnostics**, which also lists the projects Focus Center holds data for. Nothing is written into your repositories or Claude's folders, except the hook entries you explicitly enable.
- **Delete.** **Focus Center: Delete Focus Center Data…** removes the state (with its backups and recovered copies), the spool and the settings backups. It shows the exact list first. Claude Code transcripts and settings are never touched. The hook script is kept while hooks are installed, so run **Disable Claude Hooks** first to remove everything. You can delete and pause in one step.
- **Offline.** The extension has no runtime dependencies, makes no network requests and runs no model. Tests enforce this: a static check over the shipped source, and a network trap during the extension-host suite.

### Optional Claude Code hooks

Hooks are **off by default**. **Focus Center: Enable Claude Hooks…** (Command Palette or the view's `…` menu) shows exactly what will change and asks for confirmation. Then it:

- copies the dependency-free hook script to Focus Center's global storage (a stable path that does not change with extension updates);
- backs up `~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`) into Focus Center's storage under `backups/`;
- adds one `async` exec-form command hook (`node <script> <Event> <spool dir>`, no shell) for SessionStart, UserPromptSubmit, Notification, PermissionRequest, PostToolUseFailure, TaskCreated, TaskCompleted, Stop, StopFailure and SessionEnd. Async hooks cannot block Claude or approve or deny anything.

Existing settings and other hooks are kept. If the settings file is not valid JSON, or changes while it is being updated, nothing is written. **Focus Center: Disable Claude Hooks…** removes only entries whose arguments reference `claude-focus-center-hook.js`. Node.js must be on `PATH`, or set `focusCenter.hooks.nodePath`.

Each hook run writes one small JSON file into Focus Center's `spool/` folder (written to a temp name, then renamed) and exits 0 with no output. It keeps only the event name, session ID, cwd, transcript path and a few minimal fields: tool name, notification type, task ID and subject, error type, and short redacted excerpts of notification messages, failing commands' first lines and Claude's last message. Tool inputs and prompts are never written. The extension watches the spool, falling back to a rescan every 2.5 s, and processes each spool file once. Every hook run is its own event: asking for the same permission twice produces two events that merge into one pending item, so a repeated prompt after you resolved the first brings it back. (If the same hook were registered twice, both runs are counted and merge into the same item.) Spool files are deleted after 7 days.

## Supported platforms and known limitations

- **Several VS Code windows:** one window at a time owns Focus Center's saved data (a lock file with a 5 s heartbeat). Other windows show their own view but are read-only: triage, linking, Mark Caught Up and Delete are refused with a message, and nothing they see is saved. When the owner closes (or stops responding for 15 s), another window takes over and adopts what the owner saved. Changes a read-only window made in memory are not kept.

- **Platforms:** VS Code 1.100+ desktop. Developed and tested on Windows 11. macOS and Linux are expected to work (no platform-specific code beyond path handling and the Windows `.cmd` launcher) but have not been tested yet.
- **Claude Code formats:** session transcripts are not a public contract. Discovery and parsing assume `~/.claude/projects/<encoded cwd>/<session id>.jsonl` with `cwd`/`gitBranch` fields, and tolerate anything else as unknown. Hook names and fields were checked against the official hooks reference on 2026-10-26.
- **Attention rules** are deliberately conservative and English-only. Precision is measured on synthetic scenarios, not yet on real sessions. Text asks are only recognised in the last two sentences of Claude's message. With parallel tool calls, a pending permission can look answered when a sibling tool's result lands (it moves to Resolved; it is never hidden).
- **Resume** starts `claude --resume <id>` in a new terminal; it does not focus a terminal where the session is already running.
- **No runtime "is Claude running" signal yet:** In Progress means unfinished work, not a live process. The optional `claude agents --json` probe from the architecture doc is not implemented.
- **Stale window:** asks older than 7 days are not raised; this is not configurable yet.

## Pilot checklist

1. `npm run package`, then `code --install-extension focus-center.vsix` (or press F5 from this folder).
2. Open **Focus Center** and run **Show Diagnostics**: check the session root, the monitored projects and that coverage is reported honestly.
3. Optionally set `focusCenter.excludedPaths` / `includedPaths`, and enable hooks (**Enable Claude Hooks…**, after reading the confirmation).
4. Use Claude Code for a day. Record each Needs You item that was wrong (false positive) or missing (false negative), and time-to-next-action in the morning.
5. Try resume, acknowledge, snooze, resolve and Catch Me Up, then restart VS Code and check that everything persisted.
6. To finish: **Disable Claude Hooks…**, **Delete Focus Center Data…**, uninstall the extension.

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
