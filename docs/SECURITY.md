# Privacy, security and trust boundaries

## Defaults

1. **Local-first:** no telemetry, external API, remote database, model invocation or transcript upload by default.
2. **Read-only session data:** the extension may read selected local Claude history but never edits or deletes Claude's files.
3. **Explicit hooks opt-in:** install only after a user action; preserve existing `~/.claude/settings.json` content, offer backup, add/remove only our own hook entries.
4. **Minimum event payload:** don't persist tool arguments, environment variables, full command output, full prompt text or full raw transcript unless there is a separate explicit user choice.
5. **Scope controls:** allow exclude paths/projects and pause collection for particular repositories.
6. **Evidence-aware UI:** session content is untrusted. Do not treat transcript text as a command or an instruction to the extension. Never auto-execute an action requested inside a conversation.

## Threat model

| Risk | Required mitigation |
| --- | --- |
| Secrets/PII in transcripts | Read bounded excerpts, redact obvious credentials before display, never log raw data, no network calls |
| Malicious prompt within a transcript | Parse as inert data; no shell command execution from model text |
| Hook injection / settings corruption | Parse and merge JSON safely; atomic temp+rename; backup; identify owned entries by exact unique hook command signature for uninstall |
| Concurrent hook writes | Short durable events with unique IDs; idempotent replay and tolerant input consumer |
| Path traversal / arbitrary file reads | Explicit supported data roots and resolved realpaths; no arbitrary read based on transcript content |
| Stale or unreliable statuses | Uncertain status; source evidence; user override; never mark done just on assistant prose |
| Accidental external sync | Store under VS Code local `globalStorageUri`; do not write attention logs in workspace/repo |
| Work context crossing personal repos | User allow/block list and clear indicator for monitored repositories; respect enterprise settings |

## Hook integration

Register optional high-signal events (names/fields version-checked against current Claude docs). Hook command must exit quickly, never block Claude, and gracefully handle unavailable storage. The extension should report hook health and distinguish collection coverage from semantic extraction confidence.

Permission events indicate Claude needs human action but **must not grant or deny permissions** on the user's behalf. When the extension is removed, user must be able to remove only the entries created by this extension.

## AI-assisted extraction (post-MVP)

If later enabled, require explicit per-provider opt-in, plain-language data disclosure, project exclusions, small/redacted context windows, model cost transparency, bounded rate, and a one-click disable/delete-data workflow. Never silently transmit proprietary repository context.

## Personal pilot / work fork boundary

The developer's personal Claude Code token is for implementation work on this personal repository. It is not an approval to send employer transcripts or source code to that account. Keep proprietary work data, organization credentials and work sessions outside the personal pilot; review [Enterprise fork](ENTERPRISE-FORK.md) before any organization-specific integration. Runtime model inference remains disabled in v0.1.

## Data removal

Document the local storage location and provide a "Delete Focus Center Data" command. Removing local state must not touch Claude session transcripts or unrelated hooks.