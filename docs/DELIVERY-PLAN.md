# MVP delivery plan (historical v0.1)

> v0.1 was merged in PR #17. For current release targets and investment decisions, see [ROADMAP.md](ROADMAP.md). The original dependency-driven plan remains below as historical context.

This is a **dependency-driven plan**, not a calendar commitment. Use the issue board to refine estimates after the first working slice.

For agent-executable sequencing, use [Claude handoff](AGENT-KICKOFF.md) and [progress checkpoint](../planning/PROGRESS.md). Implement one dependency-ready P0 issue at a time on `feat/mvp`, with an issue-scoped commit and a persistent progress checkpoint.

## Milestones

### M0 — Foundation and observability (P0)

- Extension scaffold with reproducible build, native Tree View stub and command registration.
- Discovery of local Claude sessions across repositories, with metadata only and incremental bounded reader.
- Example fixtures and supported environment diagnostics.

**Demo:** start VS Code, see recent local sessions in the Focus Center panel, refresh, and identify a source session.

### M1 — Attention signal (P0)

- User-opt-in hook installation; nonblocking event spool and replay-safe normalizer.
- Attention reducer/classifier and local persistent state; direct permission/task/failure signals before heuristics.
- Evidence-backed groups in the Tree View and an item details view.

**Demo:** fire fixture hooks and watch Needs You change without re-reading all conversations; restart without losing state.

### M2 — Everyday usability and hardening (P0)

- Resume a session in the correct project working directory.
- Acknowledge/snooze/resolve/reopen; conservative session grouping by exact refs and repo+branch.
- Catch Me Up delta from durable checkpoint; clear collection-health and uncertain state.
- Privacy controls, installation/uninstallation, fixtures, end-to-end acceptance tests.

**Demo:** the complete morning triage -> daytime event -> resume -> end-of-day recap workflow with at least 10 fixture sessions.

## Post-MVP (P1)

- Opt-in semantic classification via a user-configured model/provider with project exclusions.
- Suggested workstream merges across unrelated repos; never silently auto-merge.
- Cloud sessions, cross-device sync, team collaboration, GitHub/ADO/CI integrations, advanced dashboard visualizations.

## Ordered delivery path

1. Scaffold, fixtures, session discovery.
2. Hook configuration safety, event spool, normalization.
3. State reducer and evidence provenance.
4. Native Tree View and resume/details commands.
5. Workstream correlation and manual triage controls.
6. Catch Me Up and privacy/diagnostics.
7. End-to-end acceptance/performance and VSIX packaging.

## MVP release checklist

- [ ] Discovery works against real Claude Code session data and sample fixtures.
- [ ] All five statuses distinguish verified from inferred state.
- [ ] Hook installation leaves other hooks intact; removal is reversible.
- [ ] Dashboard is restart safe and event replay safe.
- [ ] Backlog acceptance tests pass, including corrupted/truncated JSONL.
- [ ] No network egress by default and no transcript data in Git repository.
- [ ] UX works in secondary sidebar and keyboard navigation.
- [ ] `code --install-extension` test works from packaged VSIX.
- [ ] README includes supported platforms, how to disable monitoring, and known limitations.