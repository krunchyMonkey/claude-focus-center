# Implementation checkpoint

This file is the durable handoff between Claude Code sessions. Record **verified facts**, not inferred work status. Update at the end of every scoped issue or meaningful interruption.

## Current checkpoint

- Date: 2026-10-26
- Current milestone: **M0 — Foundation**
- Last verified issue: **09-sidebar** (GitHub #9)
- Next ready issue: **10-resume-details** (also ready: 11-triage-controls, 13-privacy-controls)
- Current branch / commit: **`feat/mvp`** (local only; not pushed, no draft PR — awaiting owner approval)
- Last executed verification: `npm run typecheck` + `npm test` (149/149 unit, 11/11 extension-host on VS Code 1.100.0)
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
| 02-session-discovery | Verified | 25/25 unit; 6/6 host tests with 10 synthetic sessions / 4 repos | `feat/mvp` (local) |
| 03-incremental-reader | Verified | 56/56 unit; 7/7 host (second Refresh reads 0 bytes) | `feat/mvp` (local) |
| 04-hook-config | Verified | 75/75 unit (byte-identical install/uninstall); 8/8 host | `feat/mvp` (local) |
| 05-event-ingestion | Verified | 90/90 unit (real hook script, 12 concurrent writers, replay); 9/9 host, hook→extension 285–303 ms | `feat/mvp` (local) |
| 06-state-model | Verified | 105/105 unit (restart, replay, corruption recovery); 10/10 host (state.json written) | `feat/mvp` (local) |
| 07-attention-rules | Verified | 20 curated scenarios; Needs You precision 100% (7/7), recall 100%; order- and replay-invariant; host: hook → Needs You item | `feat/mvp` (local) |
| 08-workstream-grouping | Verified | 143/143 unit (same ticket merges, same-name repos separate, manual link survives re-import, conflicts kept); 11/11 host | `feat/mvp` (local) |
| 09-sidebar | Verified (automated) | 149/149 unit; 11/11 host: hook → Needs You node + badge with no refresh | `feat/mvp` (local) |
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

### 2026-10-26 — Issue 02 / Discover local Claude Code sessions
- Status: Verified (automated, synthetic fixtures only).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(02): discover local Claude Code sessions…"; not pushed.
- Changed: `src/adapters/claudeSessions/paths.ts` (default root honouring `CLAUDE_CONFIG_DIR`, folder-name encoding, conservative exclusion matching), `src/adapters/claudeSessions/discovery.ts` (bounded discovery: newest 200 files, 64 KB header parse for cwd/branch, safe session-ID charset, duplicate/unreadable/missing diagnostics, no symlink following, no content retained), `src/ui/nodes.ts` (pure tree model: "Recent sessions" group), `src/ui/focusTreeProvider.ts` (descriptions, tooltips, icons), `src/diagnostics/report.ts` (session coverage + discovery section), `src/extension.ts` (discovery on activation/Refresh/setting change; serialised refresh; view message for missing root or partial coverage), `package.json` (`focusCenter.excludedPaths`, new welcome text), `src/test/fixtures/sessions.ts` (synthetic generator, written to temp dirs because `*.jsonl` is git-ignored), unit + host tests, README "What it reads".
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 25 pass, 0 fail (discovery: 10 unique sessions across 4 repos with id/path/cwd/branch/timestamp; missing root → `root-missing`; folder-level exclusion skips before read; cwd-level exclusion fallback; malformed/partial/empty lines; header byte budget; duplicate IDs; unsafe file names; max-session bound; subagent subfolders ignored; Windows/POSIX exclusion matching).
  - `npm run test:host` (VS Code 1.100.0, `CLAUDE_CONFIG_DIR` → temp synthetic root) → 6/6: Refresh lists 10 sessions/4 repos; Diagnostics shows "10 session(s), 0 excluded" and partial coverage (hooks missing); `excludedPaths` drops a repo to 7; with all repos excluded Refresh/Diagnostics still work and the tree is empty.
- Manual smoke test: not performed. F5 on this machine would read **real** session headers from `%USERPROFILE%\.claude\projects`; the agent has not run or inspected that.
- What is still unverified: behaviour on real Claude Code transcripts (format assumed from public behaviour: `<root>/<encoded cwd>/<sessionId>.jsonl`, records with `cwd`/`gitBranch`); unreadable-file path on Windows (cannot chmod); macOS/Linux.
- Next ready issue: 03-incremental-reader.
- Decision or permission needed: none new.

### 2026-10-26 — Issue 03 / Incremental JSONL reader
- Status: Verified (automated, synthetic fixtures only).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(03): incremental, schema-tolerant transcript reader…"; not pushed.
- Changed: `src/adapters/claudeSessions/reader.ts` (byte-offset cursor; unchanged size+mtime+fully-read files are not opened; partial last line held back; truncation and in-place rewrite detected via size and a 256-byte prefix hash; oversized lines skipped; cold start of large files reads only the last 1 MB), `src/adapters/claudeSessions/tailer.ts` (per-file cursors, dedupe by stable event id, 16 MB soft per-poll budget with deferral, per-file errors), `src/domain/events/types.ts` (`NormalizedEvent` v1), `src/domain/events/transcript.ts` (schema-tolerant normalizer: user-prompt without text, assistant-text with 400-char redacted tail, tool-use name only, tool-result error flag + 200-char redacted excerpt, system error flag; ids = uuid or line hash), `src/domain/events/redact.ts` (credential masking before truncation), diagnostics "Transcript ingestion" section, Refresh now polls transcripts.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 56 pass, 0 fail. Reader: unchanged skip, partial line, append, truncation, same-length rewrite, oversized line, cold-start tail, CRLF/empty, touch, missing file, budget resume, no busy re-read of partial EOF line. Tailer: replay emits nothing, restart gives identical ids, append-only emission, reordered rewrite → reset with 0 new events, duplicate UUIDs, corrupt lines, missing file, byte budget deferral. Normalizer: prompt text/tool args/tool output/thinking never retained; invalid input never throws; unsafe uuids hashed; bad timestamps dropped. Redaction: 9 credential shapes, prose untouched.
  - `npm run test:host` → 7/7, including: first Refresh ingests 20 events from 10 sessions; second Refresh reads 0 bytes, 10 files unchanged, no new events.
- Bug found and fixed during verification: a read stopped by the byte budget was treated as "unchanged" on the next call (now tracked with `cursor.readTo`).
- What is still unverified: real Claude Code transcript shapes (assumed: `type` user/assistant/system/summary, `message.content` string or blocks with text/tool_use/tool_result); cursors and seen ids are in memory only, so a VS Code restart re-reads (still no duplicates within a run; cross-restart dedupe needs issue 06); the seen-id set grows unbounded within a session.
- Next ready issue: 04-hook-config (touches `~/.claude/settings.json` only through explicit user opt-in; tests will use temp settings files).
- Decision or permission needed: none yet.

### 2026-10-26 — Issue 04 / Safe optional hooks
- Status: Verified (automated, temp settings files only — the real `~/.claude/settings.json` was not touched).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(04): opt-in, reversible Claude Code hook configuration…"; not pushed.
- Hook facts checked against https://code.claude.com/docs/en/hooks on 2026-10-26: event names; exec form (`command` + `args`, no shell; on Windows `command` must be a real .exe); `async: true` hooks cannot block or decide; `PermissionRequest`/`TaskCompleted` exit 2 would block only if synchronous; settings edits are picked up by Claude's file watcher. Installed Claude CLI version could not be probed (`claude` not on PATH), so no version gate is applied yet.
- Changed: `src/adapters/claudeHooks/settings.ts` (pure install/remove; ownership = handler args/command reference `claude-focus-center-hook.js`; refuses unexpected shapes; idempotent), `src/adapters/claudeHooks/installer.ts` (settings path honours `CLAUDE_CONFIG_DIR`; backup to global storage before every write; temp file + rename; aborts if the file changed after reading; refuses invalid JSON; keeps indentation/EOL/BOM/trailing newline; node lookup scans absolute PATH entries without executing), `src/hook/claude-focus-center-hook.ts` (placeholder: drains stdin, exit 0, no output, 2 s safety exit), `src/ui/hookCommands.ts` (Enable/Disable commands with modal confirmation listing file, events, command and backup location), `focusCenter.hooks.nodePath` setting, hook coverage in Diagnostics, README section.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 75 pass, 0 fail. Includes: enable then disable restores a 4-space-indented third-party settings file **byte-identically**, with backups of each prior version and no temp files left; idempotent enable (no rewrite, no extra backup); missing file created then reduced to `{}`; invalid JSON (with a comment) never modified; CRLF/BOM preserved; shared matcher group keeps third-party handler; ownership needs the exact script name; compiled hook script exits 0 with empty stdout.
  - `npm run test:host` → 8/8, including: activation + Refresh leave a pre-existing synthetic settings.json unchanged; Diagnostics reports hooks "not enabled".
- Known limitation (tested): a pre-existing *empty* `"hooks": {}` or `"Stop": []` is not restored after install+uninstall (same meaning to Claude). Unusual JSON formatting (e.g. inline arrays) is normalised on write.
- Not verified: the modal Enable/Disable flows by hand; a real Claude Code session executing the hook on Windows (Git Bash vs exec form); the `claude` CLI version gate.
- Next ready issue: 05-event-ingestion.
- Decision or permission needed: none — enabling hooks on this machine remains the owner's explicit action.

### 2026-10-26 — Issue 05 / Nonblocking hook event spool and idempotent normalizer
- Status: Verified (automated, synthetic payloads; no real Claude session drove the hook yet).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(05): nonblocking hook event spool…"; not pushed.
- Changed: `src/hook/` is now a dependency-free folder copied on enable: `claude-focus-center-hook.js` (stdin ≤ 1 MB, temp-file + rename into the spool, 10 000-file cap, 5 s safety exit, always exit 0, never prints), `spoolRecord.ts` (sanitiser: per-event minimal fields, id = sha256 of raw stdin), `redact.ts` (moved here; `domain/events/redact.ts` re-exports). Hook args now `[script, event, spoolDir]`. `src/domain/events/hook.ts` (re-validates spool records as untrusted, maps 10 hook events to new `EventKind`s, re-bounds excerpts), `src/adapters/claudeHooks/spool.ts` (each file read once, each event id emitted once, invalid files not retried, 7-day pruning, stale temp cleanup), `spoolWatcher.ts` (fs.watch + 100 ms debounce + 2.5 s rescan, non-overlapping scans), extension wiring, Diagnostics "Hook events" section and hook coverage ("active" only when all 10 events are installed), README.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 90 pass, 0 fail. Includes the compiled hook run via `node` (exec form): exits 0 in < 3 s with empty stdout/stderr; tool input/prompt/task description never written; 12 concurrent hook processes → 12 intact files, 12 unique events, 0 invalid; replayed delivery → 0 new events (1 duplicate dropped); invalid/empty/oversized stdin and an unwritable spool → exit 0, nothing written.
  - `npm run test:host` twice in a row → 9/9 both times. A real hook process (run by the extension host's executable as Node) produced a `permission-request` event seen by the extension in **285 / 290 / 303 ms** without a manual refresh; replay added nothing.
- Fixed during verification: host runs shared VS Code user data, so a second run treated the first run's spool file as a replay. The runner now uses a fresh temp `--user-data-dir` per run.
- What is still unverified: a real Claude Code session executing the hook on Windows (Git Bash) or macOS; real payload shapes beyond the documented fields; dedupe across extension restarts relies on spool files plus in-memory ids (persisted ids arrive with issue 06).
- Next ready issue: 06-state-model.
- Decision or permission needed: none.

### 2026-10-26 — Issue 06 / Persist evidence-backed state
- Status: Verified (automated).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(06): persisted, versioned, replay-safe state…"; not pushed.
- Changed: `src/domain/state/types.ts` (schema v1 `FocusState`: sessions, attention items, evidence refs, workstreams, manual links, processed event ids, transcript cursors, change journal, Catch Me Up checkpoint seq — contract types from docs/ARCHITECTURE.md), `src/domain/state/reducer.ts` (deterministic, idempotent `applyEvents` with a 50 000-id dedupe window; session metadata; 2 000-entry journal), `src/storage/jsonStore.ts` (`StateStore` interface; atomic temp → `.bak` → rename; recovery: invalid/corrupt/unreadable/newer-schema files are moved aside, never deleted, then backup or empty state), `src/storage/validate.ts`, `src/storage/stateService.ts` (debounced save, serialized writes, save errors surfaced and retried), tailer cursor import/export (garbage cursors ignored). `activate` is now async: loads state before the first refresh, restores cursors, routes transcript and hook events through one `ingest` dedupe, flushes on `deactivate`. Diagnostics "Saved state" section; warning toast when recovery happened.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 105 pass, 0 fail. Includes: replay (also reversed) applies nothing; two fresh states fed the same events are deep-equal; save → new store instance → load is deep-equal and replay is a no-op; `.bak` kept, no temp files; partial-write JSON → original moved aside + backup used; corrupt primary and backup → empty state with both originals kept; crash between renames → backup restored; newer schema moved aside; validator cases; debounced/forced saves; failed save reported then retried; persisted cursors → restarted tailer reads 0 bytes.
  - `npm run test:host` → 10/10: after Refresh, `state.json` in global storage holds the 10 synthetic sessions with cwd, 10 cursors, ≥ 20 processed ids, no fixture prompt/reply text, and lives outside Claude's folders.
- Bug found and fixed during verification: discovered-session records kept `undefined` fields, so in-memory and reloaded state differed.
- What is still unverified: an actual VS Code restart by hand (restart is simulated by new store/tailer instances); `items`/`workstreams` stay empty until issues 07/08; state of sessions later added to `excludedPaths` is not purged yet (issue 13).
- Next ready issue: 07-attention-rules.
- Decision or permission needed: none.

### 2026-10-26 — Issue 07 / Attention classification
- Status: Verified (automated, curated synthetic scenarios).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(07): rules-first attention classification…"; not pushed.
- Rules (`src/domain/attention/classifier.ts`, `text.ts`), run inside the reducer for every newly applied event:
  - Needs You (direct): `PermissionRequest` / `permission_prompt` notification (merged into one item, P0); `elicitation_dialog` / `agent_needs_input` (P1); `StopFailure` (P1).
  - Needs You (inferred): explicit closing asks in the last two sentences of assistant text or the Stop excerpt — decision (P1) or review (P2). Code blocks are stripped (including excerpts that start inside one).
  - Uncertain: turn ended (Stop) right after a failed command with nothing succeeding in between; transcript system errors; needs-you items whose session ended; items older than 7 days.
  - In Progress / Resolved: `TaskCreated` / `TaskCompleted`, marked "reported complete, not verified".
  - Never: Stop, SessionEnd, `idle_prompt`, completion prose, subagent (sidechain) text.
  - Resolution compares source timestamps using per-session markers (`lastPromptAt`, `lastToolUseAt`, `lastClaudeActivityAt`, `lastToolOkAt`, `lastToolFailure`, `lastStop`, `lastSessionEndAt`), so arrival order does not matter. A reply resolves; later Claude activity resolves permissions and failures; a later tool call drops a mid-turn ask. Newer blocking evidence reopens a manually resolved item.
- Extension: hook arrivals trigger a debounced transcript re-read (1.5 s); periodic refresh every 60 s; Diagnostics shows item counts by status.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 132 pass, 0 fail. 20 curated scenarios (permissions, answered permissions, merged notifications, decisions, completion claims, mid-turn questions, replies, API failure, recovered vs unrecovered tool failures, tasks, task-vs-permission conflict, review, stale, subagent, session end, transcript-only, late hook, code-block question, idle prompt). Needs You precision 100% (7/7), recall 100% (7/7). Every scenario gives the same result with events reversed and is unchanged by replay. Every item has evidence with a source event id and timestamp.
  - `npm run test:host` → 10/10. A real hook process's `PermissionRequest` becomes a direct Needs You item "Permission needed: Bash" with hook evidence; latency 331 ms.
- Bugs found and fixed during verification: "turn ended on failure" and "session ended while pending" depended on arrival order (now marker-based); "I need your approval" was classed as review rather than decision.
- Risks / still unverified: precision is measured on scenarios written alongside the rules, so real-session precision is unknown until the pilot (issue 14). Parallel tool calls could make a pending permission look answered when a sibling tool's result lands later (would show as Resolved, not hidden). Text asks are English-only. The stale window (7 days) is fixed, not a setting.
- Next ready issue: 08-workstream-grouping.
- Decision or permission needed: none.

### 2026-10-26 — Issue 08 / Cross-session grouping
- Status: Verified (automated). Manual link/unlink quick-pick flows were not exercised by hand.
- Branch / commit / draft PR: `feat/mvp`, commit "feat(08): conservative workstream grouping…"; not pushed.
- Changed: `src/domain/workstreams/refs.ts` (exact namespaced refs: `AB#n` → `ado:n`, `PROJ-n` → `jira:PROJ-n` with standards such as UTF/ISO/SHA/RFC/CVE excluded, bare `#n` / `123-…` branch → `github:<repo key>#n`), `src/domain/workstreams/group.ts` (pure `regroup`: manual link > work-item ref (branch, then task-subject tokens) > repo root + branch > session alone; repo identity case-folded only on win32/darwin; conflict notes for "one session reports complete while another has open items" and "one session references two tickets"; `linkSession` / `linkToNewWorkstream` / `unlinkSession` journaled as user actions), `src/adapters/git/repoRoot.ts` (nearest ancestor with `.git` folder or file, existence check only, cached), session fields `repoRoot` and `workItemHints` (only the tokens, not task text), `Workstream.conflicts`, `manualWorkstreamTitles`. Commands "Link Session to Workstream…" and "Restore Automatic Grouping…" (quick picks; accept a session id for tree menus later). Regroup runs after every refresh and every applied batch; items follow their session's workstream.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 143 pass, 0 fail. Includes: same Jira key merges sessions across two repos; a task-subject ref links a session with an unrelated branch; four sessions in two same-named `api` repos stay separate (same branches, same `#123`); repo-root grouping includes a subfolder session but not a worktree or another branch; manual link + "keep separate" survive re-import and new events; unlink restores automatic grouping; unique ids for same-named manual workstreams; both conflict notes; a permission request is not hidden by a sibling's completion; regroup deterministic and idempotent; repo-root detection for `.git` folder and worktree `.git` file.
  - `npm run test:host` → 11/11, including grouping of the synthetic fixture sessions (alpha feat/login ×2 together, alpha main separate, beta `fix/123-header` grouped by work item).
- Fixed during verification: standards tokens (e.g. "UTF-8") in task subjects would have merged unrelated sessions as one Jira ticket.
- What is still unverified: repo-root detection on real repositories and network drives; quick-pick UX by hand; uppercase tokens outside the standards denylist can still look like Jira keys when written in task subjects.
- Next ready issue: 09-sidebar.
- Decision or permission needed: none.

### 2026-10-26 — Issue 09 / Native focus queue sidebar
- Status: Verified by automated checks; **not yet looked at by a person** (no screenshot capability in this session).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(09): native attention queue…"; not pushed.
- Changed: `src/ui/nodes.ts` (pure `buildAttentionNodes`: status groups in priority order — Needs You always, with "Nothing needs you right now" when empty; In Progress; Waiting; Uncertain; Resolved collapsed; then workstreams (conflict icon/notes); then items sorted by priority, acknowledgement and recency, with repo · age · direct/inferred · overrides · evidence count; Markdown tooltip with Why (latest 3 evidence), Next step and Source session(s), Markdown escaped; screen-reader labels; `contextValue` per status; collapsed "All sessions" group), `src/domain/attention/effective.ts` (snooze → Waiting, manual resolve → Resolved, rule status untouched), `src/ui/focusTreeProvider.ts` (theme-colored icons, collapsible state, Markdown tooltips, accessibility info, `getParent`), extension `render()` after every discovery and every applied hook batch; view badge and description with the Needs You count; welcome content (Refresh / Enable Hooks / Diagnostics) when there is nothing at all; item/session context menu for link/unlink.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 149 pass, 0 fail. Tree built from all 20 curated scenarios: groups ["Needs You", "Uncertain", "Resolved"], Needs You count 7 = badge count; P0 permission first; description/tooltip/aria/context values; explicit empty Needs You; snooze → Waiting (and expiry), manual resolve → Resolved with the rule status kept; workstream conflict icon; All sessions group; Markdown escaping in titles and excerpts.
  - `npm run test:host` → 11/11. With synthetic sessions only: roots = Needs You (explicitly empty) + All sessions (10), no badge. After a real hook process's PermissionRequest: the item is in Needs You and the badge is 1 with no manual refresh (266 ms).
- Not verified: visual appearance, high-contrast rendering and dragging the view to the secondary side bar by hand (native TreeView, which VS Code supports; no custom rendering); screen-reader output.
- Next ready issue: 10-resume-details.
- Decision or permission needed: none.

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