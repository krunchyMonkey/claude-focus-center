# Claude Focus Center — MVP

A lightweight personal GitHub Project tracking delivery of a **local-first VS Code attention dashboard for Claude Code**.

## Suggested board organization

- **Status:** Backlog, Todo, In Progress, In Review, Done (the initial board uses GitHub defaults; customize the Status field in the UI if needed).
- **Labels:** priority:p0, priority:p1, phase:foundation, phase:ingestion, phase:attention, phase:ux, phase:quality, type:feature, type:chore, type:spike, mvp.
- **Views:** Board by Status, Table sorted by priority, and an MVP-only filter (`label:mvp`).
- **Milestones:** M0 Foundation, M1 Attention, M2 Usable MVP (represented by issue labels or a separate Project field if desired).

## Weekly review questions

1. Can a user immediately tell what needs their input?
2. Which attention records lack trustworthy evidence?
3. Are we collecting too much transcript data or creating noisy alerts?
4. Can the newest vertical slice be demonstrated in a clean VS Code extension host?
5. What's the smallest change that brings us closer to the full morning/day/evening workflow?

## GitHub bootstrap

`scripts/bootstrap-github.sh` works only with the existing public repository. It creates missing labels and issues, updates labels on existing issues, and optionally creates the personal Project board. It never creates a repository, changes visibility, or pushes Git history. Project board customization beyond the default Status field is intentionally manual for the first pass.