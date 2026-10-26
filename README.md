# Claude Focus Center

**Know what needs your attention across Claude Code sessions—without managing another task list.**

A planned local-first VS Code extension that turns activity across multiple Claude Code sessions, repositories, and worktrees into a concise attention queue.

> **Project status (2026-10-26):** implementation-ready specification and Claude Code handoff in the public [GitHub repository](https://github.com/krunchyMonkey/claude-focus-center). The extension itself has not been implemented yet.

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
