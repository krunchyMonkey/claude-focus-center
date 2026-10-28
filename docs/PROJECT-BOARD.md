# GitHub Project — Claude Focus Center Roadmap

This is a **decision and capacity board**, not an obligation to deliver every feature.

## Current project setup

GitHub repository: https://github.com/krunchyMonkey/claude-focus-center

The connected GitHub app can create and update issues but **cannot create a GitHub Projects v2 board**. To provision the board from your local authenticated GitHub CLI:

```bash
gh auth login
gh auth refresh -s project
git pull --ff-only
bash scripts/create-project-board.sh
```

The script reuses `Claude Focus Center Roadmap` if one already exists; it links it to this repository, adds issues and configures fields. It leaves issue content, repository visibility, and code unchanged. The board is configured as **public** to match this repository; adjust visibility manually if preferred. If a command fails, fix the error and rerun it.

## Recommended views

1. **Now:** Table filtered to Release = `v0.1 Pilot`, grouped by Status; show `Effort (h)` and `Owner attention (h)`.
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

See [ROADMAP.md](ROADMAP.md) for investment levels, target windows and the decision gates.