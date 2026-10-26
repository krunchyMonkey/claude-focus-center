# Engineering contracts for v0.1

Use this to settle cross-cutting choices before the first feature implementation. Keep it subordinate to `docs/MVP-SPEC.md` and `docs/SECURITY.md`.

## Suggested package boundaries

```text
src/
  extension.ts               # activation and command wiring only
  adapters/
    claudeSessions/           # session discovery and incremental JSONL parsing
    claudeHooks/              # opt-in config management and spool consumer
    claudeAgents/             # optional version-gated background-agent status
  domain/
    events/                   # validated versioned normalized events
    attention/                # evidence-backed deterministic state transitions
    workstreams/              # exact linking and manual overrides
  storage/                    # local store interface and atomic JSON implementation
  ui/                         # TreeDataProvider, item details, commands
  diagnostics/                # health and failure visibility
  test/fixtures/              # synthetic, sanitized source records only
```

This is a suggested shape; use simpler modules when the first vertical slice does not need every folder.

## Source adapters and trust levels

| Source | Evidence level | Expected use | Failure response |
| --- | --- | --- | --- |
| Claude `PermissionRequest`/permission notifications | Direct event | Needs You; avoid duplicate alerts | Show partial coverage if hooks unavailable |
| Claude `TaskCreated` / `TaskCompleted` | Direct agent-reported | Track tasks; completion is **reported**, not code-review-verified | Preserve Uncertain if contradicted |
| `Stop` / `SessionEnd` | Lifecycle only | Update activity recency | Never auto-resolve a workstream |
| Local transcript message | Untrusted content | Extract explicit ask and source pointer | Parse errors don't crash UI |
| `claude agents --json` | Version-gated runtime snapshot | Optional *actually running* badge for background agents | Unavailable = unknown, never offline/done |
| User triage action | Explicit user assertion | Acknowledge / snooze / mark resolved | New direct blocker can reopen |

`claude agents --json` is not a prerequisite for M0 and should not be polled aggressively. It is only a supplemental snapshot for versions that support the official command.

## Normalization / deduplication

- Event identity should be stable across file rereads, partial writes, restarts, and duplicate hooks; avoid timestamp-only IDs. Use source UUID when available or an immutable `sessionId + source event identity`/hash.
- Keep `(source, sessionId, eventId)` unique in the reducer. Offset, mtime, or arrival time are cursors, not logical identifiers.
- Validate runtime inputs (no assumption that JSON or event schema is correct). Bound payload sizes and excerpt lengths before persistence.
- Store source pointer, bounded safe metadata and event kind. Never store raw prompts, tool arguments, command output, or full transcript content in local persistent state by default.
- Maintain a clear distinction between **reported**, **verified**, **inferred**, and **manually overridden** state. A manual resolution should not erase the original source events.

## Workstream identity

- Prefer explicit namespaced external identifiers (for example `ado:12345` versus `github:org/repo#123`), then same canonical repo root + branch, then a persisted manual link.
- Repositories with matching directory basenames are not identical; resolve real paths where authorized. Do not infer link from prose similarity alone.
- Conflicting signals remain visible with their sources. Never suppress a new permission request because a related agent reported completion.

## Local storage and extension lifecycle

- Store user state under `vscode.ExtensionContext.globalStorageUri`; do not write state in monitored repositories or Claude's transcript directories.
- Use atomic writes and restart-safe migration markers; bounded change journal supports deterministic Catch Me Up.
- The extension should start normally when no Claude CLI, no sessions, no hooks, or no access to some directories exists.
- When settings/hooks are enabled, use precise additive changes with backups. Uninstall only entries owned by this extension.
- Exclusions must be applied **before** transcript reads, not just before UI display.

## Tests that must exist before pilot

1. Session files: empty, malformed JSON, partial final line, appended event, file rewrite/truncation, duplicate UUID, unreadable path and stale session.
2. Hooks: opt-in, preserve third-party config, duplicate events, concurrent writers, missing spool, quick zero-exit failure and exact removal.
3. State: conflicting completion/permission signals, user resolve followed by new blocker, ack/snooze after restart, change recap checkpoint.
4. Workstreams: same namespaced ticket linked; similar titles in different repos remain separate; manual split survives reimport.
5. UI: zero sessions, >10 sessions, narrow secondary sidebar, keyboard actions, missing CLI and unsafe session ID.
6. Security: no network traffic by default; no secrets/transcript text committed; excluded project is not ingested.

Acceptance should be scored on *precision of attention items*, not number of detected conversations. Validate against `docs/MVP-SPEC.md` and `planning/issues/14-acceptance-qa.md`.

## Official references

- Hook schemas: https://code.claude.com/docs/en/hooks
- CLI/agents/resume: https://code.claude.com/docs/en/cli-reference
- Local Claude session retention: https://code.claude.com/docs/en/data-usage
- VS Code Tree API: https://code.visualstudio.com/api/extension-guides/tree-view