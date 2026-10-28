# Implementation checkpoint

This file is the durable handoff between Claude Code sessions. Record **verified facts**, not inferred work status. Update at the end of every scoped issue or meaningful interruption.

## Current checkpoint

- Date: 2026-10-26
- Current milestone: **M2 — complete except the human pilot (issue 14 partial)**
- Last verified issue: **13-privacy-controls** (GitHub #13); **14-acceptance-qa is Partial** (all automated acceptance verified; human pilot not done)
- Next action: **owner pilot** (README "Pilot checklist") and owner decision on pushing `feat/mvp` / opening a draft PR
- Current branch / commit: **`feat/mvp`** (local only; not pushed, no draft PR — awaiting owner approval)
- Last executed verification (clean `npm ci`): `npm run typecheck`; `npm test` = 182/182 unit + 20/20 extension-host + gold-path acceptance 7/7 → restart → 5/5; `npm run test:vsix` 1/1 (VS Code 1.100.0)
- Known blockers: none technical. Pilot needs the owner; pushing/PR needs the owner's approval (public repo). Dev-only audit advisory in `@vscode/vsce` → `@azure/msal-node` (see issue 14 checkpoint).

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
| 10-resume-details | Verified (automated) | 157/157 unit; 14/14 host: details doc opens; fake `claude.cmd` (path with a space) started in the session cwd with `--resume <id>`; unknown session / missing cwd refused | `feat/mvp` (local) |
| 11-triage-controls | Verified (automated) | 165/165 unit (restart, expiry, supersede, reopen); 15/15 host (snooze auto-expiry, resolve persisted, fresh prompt reopens) | `feat/mvp` (local) |
| 12-catch-me-up | Verified (automated) | 172/172 unit (no invented changes incl. after replay; restart; trimming disclosed); 16/16 host | `feat/mvp` (local) |
| 13-privacy-controls | Verified (automated) | 180/180 unit (scope, purge, delete, hook skips, static no-network); 20/20 host (drop + purge, pause, delete, network trap) | `feat/mvp` (local) |
| 14-acceptance-qa | **Partial** | Gold-path acceptance across a real restart, latency, replay, malformed data, network trap, VSIX package + isolated install smoke all pass; **human pilot not done** | `feat/mvp` (local) |

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

### 2026-10-26 — Issue 10 / Evidence details and resume
- Status: Verified by automated checks with a fake CLI. The real `claude` CLI is not on PATH in this environment, so a real resume was not run.
- Branch / commit / draft PR: `feat/mvp`, commit "feat(10): evidence details and safe session resume…"; not pushed.
- Changed: `src/adapters/claudeCli/resume.ts` (`planResume`: strict session-ID charset, which also blocks option injection such as `-rf` or `--dangerously-skip-permissions`; cwd must exist as a directory; CLI from `focusCenter.claudePath` or an absolute PATH entry; missing-transcript warning; CLI as the terminal process with `['--resume', id]`; Windows `.cmd`/`.bat` shims via `cmd.exe /d /s /c ""<cli>" --resume <id>"` with cmd metacharacters in the path refused), `src/ui/details.ts` (pure Markdown: why / what changed / source session / next step, escaped), `src/ui/sessionCommands.ts` (read-only `focus-center:` virtual documents that re-render on state change; Show Details and Resume Session commands returning outcomes for tests; copyable command on failure), tree items open details on click/Enter, inline + context-menu resume for items and sessions, `focusCenter.claudePath` setting, README.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 157 pass, 0 fail (8 unsafe IDs refused; unknown/deleted/non-directory cwd; missing, relative or nonexistent CLI; configured path wins; transcript warning; Windows cmd command line and refusal of `a&b`; PATH search; details content and escaping).
  - `npm run test:host` → 14/14. Clicking the hook-created item opens a `focus-center:` Markdown document with all five sections. Resume of an unknown session → `unknown-session`; of a fixture session whose cwd does not exist → `cwd-missing` (no terminal). Resume of a new session with a real temp cwd, using a fake CLI `fake claude.cmd` (note the space) → terminal started; the fake recorded cwd = the session cwd and args = `--resume <id>`.
- What is still unverified: real `claude --resume` (CLI not installed on PATH here); macOS/Linux terminal launch; the modal "Resume Anyway" path by hand.
- Next ready issue: 11-triage-controls.
- Decision or permission needed: none.

### 2026-10-26 — Issue 11 / Triage controls
- Status: Verified (automated). Context-menu and inline buttons were not clicked by hand.
- Branch / commit / draft PR: `feat/mvp`, commit "feat(11): acknowledge, snooze, resolve and reopen…"; not pushed.
- Changed: `src/domain/attention/triage.ts` (acknowledge, snooze until a future time, resolve (clears snooze), reopen (clears overrides; an item the rules resolved goes back to Needs You or In Progress for tasks; sets `reopenedAt`); every action adds `user-action` evidence and a journal entry; `nextSnoozeExpiry`, `tomorrowMorning` (09:00 local), `availableActions`), classifier: newer blocking evidence clears an older manual resolution, snooze or acknowledgement; rule timing and displayed age use *source* evidence only, so user actions never move them; `AttentionItem.snoozedAt` / `reopenedAt`. `src/ui/triageCommands.ts` (commands accept a node, an id or a quick pick; snooze quick pick 1 h / 4 h / tomorrow 09:00), status-aware context menus and inline buttons, re-render timer at the next snooze expiry, README.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 165 pass, 0 fail. All four actions with overrides only (rule status kept), journal + user-action evidence, source age unchanged; invalid requests change nothing; acknowledge/snooze survive a store round trip and a replay after "restart"; a re-raised prompt after acknowledge/snooze/resolve returns the item to Needs You; older evidence does not undo a user action; a new permission after an answered one appears as Needs You; reopening a rules-resolved item stays Needs You until *newer* activity answers it.
  - `npm run test:host` → 15/15. On the hook-created item: acknowledge keeps it in Needs You; a 2 s snooze moves it to Waiting (badge cleared), then it returns to Needs You by itself; resolve moves it to Resolved and `manuallyResolvedAt` + `acknowledgedAt` are in `state.json`; a fresh `permission_prompt` notification from a real hook process puts it back in Needs You with badge 1.
- Not verified: an actual VS Code restart by hand (restart covered by store round trips); menu placement and look.
- Next ready issue: 12-catch-me-up.
- Decision or permission needed: none.

### 2026-10-26 — Issue 12 / Catch Me Up
- Status: Verified (automated).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(12): deterministic Catch Me Up recap…"; not pushed.
- Changed: `src/domain/recap/recap.ts` (`buildRecap` from journal entries after `checkpointSeq`: one entry per item with current displayed status and up to 3 changes; groups Needs you now / Resolved / Other; new sessions; user actions counted only; `truncated` when the bounded journal dropped entries after the checkpoint; `markCaughtUp(toSeq)` moves the checkpoint only to the end of the recap the user saw and records `checkpointAt`), `src/ui/recap.ts` (Markdown, escaped), `src/ui/recapCommands.ts` (Catch Me Up opens a read-only recap document with a fresh URI per journal range plus a notification with "Mark Caught Up"; Mark Caught Up command), toolbar button, `FocusState.checkpointAt`, README.
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 172 pass, 0 fail. Includes: fresh state → "Nothing has changed"; the curated set → 7 Needs You (P0 first), resolved and new sessions; after Mark Caught Up, a full duplicate replay gives an empty recap (only the "caught up" action counted); later changes show only the newly resolved item, with triage counted not listed; changes arriving while the recap is open stay for the next one; recap and checkpoint identical after a store round trip; trimming disclosed.
  - `npm run test:host` → 16/16. First Catch Me Up lists the hook permission under Needs you now; Mark Caught Up sets the checkpoint; Refresh (no new data) → empty recap; a new StopFailure from a real hook process → recap shows it and does not repeat the earlier permission; checkpoint persisted in `state.json`.
- Fixed during verification: reopening an already-open recap URI showed VS Code's cached text; each recap now has its own URI. An early `markCaughtUp` draft would have skipped changes that arrived while the recap was open.
- Not verified: the notification button click by hand.
- Next ready issue: 13-privacy-controls.
- Decision or permission needed: none.

### 2026-10-26 — Issue 13 / Privacy controls, diagnostics and data removal
- Status: Verified (automated).
- Branch / commit / draft PR: `feat/mvp`, commit "feat(13): privacy scope, pause, purge and data deletion…"; not pushed.
- Gaps found against docs/SECURITY.md and closed: (1) hook events from excluded projects were still spooled and ingested — the extension now writes `hooks/scope.json` and the hook skips out-of-scope / paused events, with the consumer filtering again; (2) data stored before a project was excluded stayed in state — it is now purged.
- Changed: `src/hook/scope.ts` (dependency-free `inScope`/`isUnder`/`parseScope`; exclusions win, allow-list restricts, pause stops collection; unknown cwd allowed only without an allow-list; broken scope file → default), discovery allow-list (pre-read folder check + post-read cwd check), `src/domain/privacy/purge.ts` (removes sessions, items, cursors, manual links and journal entries for out-of-scope sessions; pause never purges), `src/storage/deleteData.ts` (plan = only state files, spool, backups, plus hooks folder when hooks are not installed; refuses paths outside storage), `src/ui/privacyCommands.ts` (Pause/Resume Monitoring, Delete Focus Center Data with the exact list and an optional pause), `StateService.reset`, `TranscriptTailer.reset`, settings `focusCenter.includedPaths` and `focusCenter.paused`, `focusCenter.paused` context key, Diagnostics "Monitoring scope" (pause state, lists, projects with stored data) and out-of-scope drop counts, README "Privacy controls".
- Checks actually run (command + result):
  - `npm run typecheck` → no errors.
  - `npm run test:unit` → 180 pass, 0 fail. Includes: scope semantics; allow-list discovery reads one project and skips three folders before reading; exclusion beats allow-list; purge leaves no trace of the excluded path in state; pause alone deletes nothing; delete plan and refusal of an outside path; **the installed hook (copied with `copyHookScripts`) writes nothing for an excluded cwd, outside the allow-list or while paused**, and falls back to the default on a broken scope file; static check: no `http/https/http2/net/tls/dgram/dns/child_process/worker_threads` imports, `fetch`, `XMLHttpRequest`, `WebSocket` or `require(` in shipped source, and no runtime dependencies.
  - `npm run test:host` → 20/20. Excluding beta purges its stored session and writes `scope.json`; a hook event from beta is counted out of scope and not stored; paused refresh does no discovery and resume does; Delete removes only paths under global storage (state.json gone, state emptied, badge cleared) while synthetic Claude `settings.json` and all transcript files are byte-for-byte unchanged, and refresh rebuilds; the network trap (`http`, `https`, `net`, `tls`, `dns`, `fetch`, installed before activation) recorded no calls from extension code across all 20 tests.
- Limits: the network trap catches calls through those module functions, not native or binding-level sockets (the static check covers imports). Pausing stops new hook records only after `scope.json` is written (immediately on the setting change).
- Next ready issue: 14-acceptance-qa.
- Decision or permission needed: none.

### 2026-10-26 — Issue 14 / Acceptance QA and VSIX pilot
- Status: **Partial** — every automated acceptance check passes; the human pilot on real Claude Code sessions (and the real `claude --resume`) has not happened.
- Branch / commit / draft PR: `feat/mvp`, commit "test(14): gold-path acceptance across restart, VSIX packaging and smoke test…"; not pushed.
- Changed: `src/test/acceptance/` (gold-path fixture: 4 projects with real temp folders, 10 sessions, one malformed transcript, hook payloads; phase 1 and phase 2 suites), `src/test/runAcceptance.ts` (two VS Code launches on the same user-data dir and Claude folder = real restart), `src/test/harness.ts` (shared runner, `runNode`, `waitUntil`, network trap; proven to catch a call by `networkTrap.test.ts`), `src/test/runVsixSmoke.ts` + `src/test/vsix/smoke.ts` (installs the VSIX into a temp extensions folder with the test VS Code's CLI and activates the installed copy via a probe extension), cumulative "Skipped since start" invalid-line count in Diagnostics, scripts `test:acceptance`, `package`, `test:vsix`, devDependency `@vscode/vsce` 4.0.0 (pinned; released 2026-09-14), `.vscodeignore`, README (test commands, supported platforms and known limitations, pilot checklist).
- Checks actually run (command + result), after `rm -rf out node_modules && npm ci`:
  - `npm run typecheck` → 0 errors.
  - `npm test` → unit 182/182 (Needs You precision 100% 7/7, recall 100%); host 20/20 (hook latency 291 ms); acceptance phase 1 7/7: 10 sessions / 4 projects give dashboard {Needs You 2, In Progress 2, Waiting 1 (snoozed), Uncertain 1, Resolved 3} = the spec's gold-path mix; every item has source evidence; no non-task item resolved without an answer; PROJ-9 workstream groups two repos and flags the conflict; mid-turn question ignored; malformed lines counted, no crash; live permission prompt → sidebar in 292 ms without reload; details document; resume via fake `fake claude.cmd` started in the session's real cwd with `--resume <id>`; acknowledge; Catch Me Up + Mark Caught Up; no extension network calls. Phase 2 (fresh VS Code process): acknowledgement, snooze and checkpoint restored; dashboard identical; 0 bytes reread for 10 unchanged transcripts; replaying all hook payloads adds no items; Catch Me Up empty, then shows only a new StopFailure; no network calls.
  - `npm run test:vsix` → packaged `focus-center.vsix` (50 files, ~89 KB: `out/**` and media only, no sources, tests, maps or transcripts); installed into a temp `--extensions-dir`; the installed copy (path under that folder) activated, registered commands, discovered 10 synthetic sessions, Diagnostics shows version 0.0.1 and no network egress.
- Dev-only advisory: `npm audit` reports 2 high (GHSA-xcx6-jx8p-x3h5) in `@azure/msal-node` via `@vscode/vsce` → `@azure/identity`; `npm audit fix` cannot resolve it (needs a major bump). It is only used for marketplace sign-in (`vsce publish`), which this project does not run, and it is not shipped in the VSIX. Not overridden.
- Still unverified (owner pilot): real Claude Code transcripts and hooks on this machine; real `claude --resume`; visual look, high contrast, secondary side bar and screen reader; macOS/Linux; CI `build` job (branch not pushed).
- Next action: owner runs the README "Pilot checklist"; owner decides on push / draft PR.

### 2026-10-27 — Follow-up to issue 10 / Click an item to go to its session (GitHub #18)
- Status: **Implemented; automated checks pass; manual click-through and tests for the new branches pending.**
- Branch / commit: `feat/mvp`, a61827e "feat(10): click an item to go to its session" (pushed; draft PR #17).
- Changed: new command `focusCenter.focusSession` ("Go to Session") in `src/ui/sessionCommands.ts`; item click (`src/ui/nodes.ts`, `src/ui/focusTreeProvider.ts`) now runs it instead of `showDetails` (Show Details stays in the context menu); `package.json` command + context-menu entry; one host assertion updated. Order: tracked terminal launched by Focus Center → `claude-vscode.editor.open <sessionId>` (Claude Code extension, command seen in installed 2.1.310) → existing resume fallback. Launched terminals are remembered per session so repeat clicks do not start duplicate resumes.
- Checks actually run, on a clean worktree of `feat/mvp` at 37824b2 (which includes a61827e):
  - `npm run test:unit` → 192/192; `npm run test:host` → 20/20; `npm run test:acceptance` → phase 1 7/7, restart, phase 2 5/5; `npm run test:vsix` → 1/1 (VS Code 1.100.0). Issue 10's original checks (details document, resume cwd/`--resume <id>`, unknown session and missing cwd refused) still pass.
  - A run in the main checkout failed one host test ("a hook event reaches the extension within 5 seconds; replay adds nothing", 2 !== 1) while uncommitted edits to `src/hook/spoolRecord.ts` and related tests were present; the same test passes on the clean worktree, so it is not caused by this change.
- Still unverified: no automated test covers the three `focusSession` branches (terminal reuse, Claude panel, fallback); real `claude-vscode.editor.open` behavior; sessions started in a plain CLI terminal are not distinguished from panel sessions (transcript `entrypoint` not read), so clicking one would open it in a Claude panel.
- Next action: add host tests with a stubbed `claude-vscode.editor.open`; handle `entrypoint`; owner click-through. Tracked in #18.

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

- [x] VS Code Extension Development Host launches with Focus Center view. — `npm run test:host` (VS Code 1.100.0); visual check by a person still pending.
- [x] Local multi-repo session discovery works without real transcript fixtures committed. — synthetic fixtures generated at test time; `*.jsonl` git-ignored; 10 sessions / 4 repos in host and acceptance runs.
- [x] Opt-in hooks are reversible and non-blocking. — byte-identical install/uninstall round trip, async exec-form hooks, hook exits 0 with no output (unit tests); not yet enabled against a real Claude Code.
- [ ] Needs You evidence is accurate; `Stop` is not treated as completion. — verified on 20 curated synthetic scenarios + gold path (Stop never resolves); **real-session precision unmeasured until the pilot**.
- [x] All triage actions and Catch Me Up survive extension restart. — acceptance phase 2 in a fresh VS Code process.
- [x] VSIX installation, privacy cleanup, and synthetic acceptance suite pass. — `npm run test:vsix` (isolated install), privacy unit + host tests, `npm run test:acceptance`.

Do not mark any release gate complete without recording how it was verified.