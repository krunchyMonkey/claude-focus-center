# GitHub Project — Claude Focus Center Roadmap

This is a **decision and capacity board**, not an obligation to deliver every feature. [GitHub Project #8](https://github.com/users/krunchyMonkey/projects/8) has been created; use the PowerShell script below to synchronize its items and fields.

## Current project setup

GitHub repository: https://github.com/krunchyMonkey/claude-focus-center

The connected GitHub app can create and update issues but **cannot create a GitHub Projects v2 board**. To **synchronize the existing board** from your authenticated Windows PowerShell:

```powershell
gh auth refresh -s project
git fetch origin
git restore --source=origin/main --worktree -- scripts/create-project-board.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\create-project-board.ps1
```

The script reuses `Claude Focus Center Roadmap` if one already exists; it links it to this repository, adds issues and configures fields. It leaves issue content, repository visibility, and code unchanged. The board is configured as **public** to match this repository; adjust visibility manually if preferred. If a command fails, fix the error and rerun it.

## Recommended views

1. **Now:** Table filtered to Release = `v0.1 Pilot` (issues #26–#28, #18 and #14), grouped by Status; show `Effort (h)` and `Owner attention (h)`.
2. **Roadmap:** Table or Roadmap grouped by Release, with Priority, Decision and remaining effort visible. Dates and capacity are approximate, described in `ROADMAP.md`; set real dates once the owner commits to a cadence.
3. **Backlog choices:** Table grouped by Decision = `Candidate`, `Optional`, `Parked`, so features can be evaluated without taking them on.
4. **Shipped:** Release = `Shipped`, for #1–#13. All were merged in PR #17; none consume remaining budget.

GitHub's built-in **Status** field remains the delivery status. `Decision` expresses product investment, not implementation progress. An issue may be `Todo` and `Optional` without being a commitment.

## Project conventions

- A feature earns **Committed** only when the owner wants to spend time on it.
- Human/owner time is tracked separately from total engineering time.
- Estimates are remaining hours; after completion set remaining effort to 0 rather than keeping historical estimates in rollups.
- Close items when acceptance is verified; don't automatically close #14 or #18 merely because automated tests passed.
- Changes can be implemented in a branch/PR while the issue remains open for manual acceptance.
- Recheck priorities after the personal pilot; the higher-level objective is *fewer interruptions*, not more features.

See [PILOT-SPRINT.md](PILOT-SPRINT.md) for implementation order and owner sign-off, and [ROADMAP.md](ROADMAP.md) for future investment choices. **Pilot remaining: 8h engineering + 4h owner**, with #14 not double-counted.