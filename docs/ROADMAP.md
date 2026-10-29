# Claude Focus Center — release roadmap and investment decisions

_Last reviewed: October 29, 2026. Planning estimates, **not delivery commitments**._

**Active, authorized sprint:** [v0.1 Pilot Readiness](PILOT-SPRINT.md). Claude may implement #26–#28; issue #14 remains a separate owner acceptance gate.

## Current reality

- The v0.1 core was **merged** in [PR #17](https://github.com/krunchyMonkey/claude-focus-center/pull/17). Issues #1–#13 are complete based on automated verification described in that PR.
- **Not yet verified by the owner:** real-session pilot and cross-platform UX ([#14](https://github.com/krunchyMonkey/claude-focus-center/issues/14)).
- A follow-up for focusing live Claude sessions is in [draft PR #19](https://github.com/krunchyMonkey/claude-focus-center/pull/19), tracked by [#18](https://github.com/krunchyMonkey/claude-focus-center/issues/18). It still needs an owner click-through and review.
- 100% precision cited for curated fixtures is **not** proof of real-world precision; validate it during the pilot.

## The decision gates

| Investment | Scope | Issues | Engineering effort left | Owner attention* | Default decision |
|---|---|---|---:|---:|---|
| **A. Use it personally** | Prepare v0.1 pilot and validate live-session jump | #26–#28, #18, #14 | **8 h** | **4 h** | **Commit now** |
| **B. Make it dependable** | Real-signal quality; cross-window storage; platform verification | #20, #21, #22 | **22 h more** | **5 h more** | Decide after pilot |
| **C. Publish a useful beta** | Fast keyboard triage; link suggestions; releases/Marketplace | #23, #24, #25 | **26 h more** | **7 h more** | Optional |
| **D. Experiment** | Optional AI classification and remote integrations research only | #15, #16 | **12 h more** | **4 h more** | Parked |

*Owner attention means reviews, manual validation, product choices and approvals; estimates assume Claude may implement code independently. Engineering effort represents human-equivalent implementation/testing hours, not a billable quote or a promise of autonomous completion. Re-estimate after each pilot/release.

**Cumulative totals:** A = 8 h engineering / 4 h owner; A+B = 30 h / 9 h; A+B+C = 56 h / 16 h; adding D = 68 h / 20 h. Historical #1–#13 work is completed and deliberately costs **0 remaining hours**.

## Proposed timeline, conditional on allocating about 6–8 engineering hours per week

| Window | Focus | Exit criteria |
|---|---|---|
| **Nov 2–8, 2026** | v0.1 pilot readiness (#26–#28), navigation (#18), owner acceptance (#14) | Complete a real session triage loop; document false positives and jump-to-session behavior; accept or defer PR #19 |
| **Nov 9–Dec 6, 2026** | v0.2 reliability (#20–#22), **only if worthwhile** | Real-world signal evaluation, writer safety, documented supported environments |
| **Dec 7, 2026–Jan 17, 2027** | v0.3 UX / public beta (#23–#25), **only if worthwhile** | Faster navigation, safe grouping assistance, versioned VSIX release and Marketplace-ready docs |
| **Unscheduled** | Experiments (#15, #16) | Written go/no-go; no automatic cloud/model integration |

These dates are **planning windows, not deadlines**. The pilot may surface issues and change sequencing. Marketplace publication and organizational deployment each require a separate explicit decision.

### Capacity alternatives

- **Light investment (~4 engineering h/week):** personally usable pilot in roughly 2 weeks; A+B+C in ~14–16 weeks.
- **Steady investment (~8 engineering h/week):** pilot in ~1 week; A+B+C in ~7–9 weeks, plus calendar/holiday slack.
- **Focused investment (~12 engineering h/week):** pilot in ~1 week; A+B+C in ~5–6 weeks, subject to pilot findings.

These are rough work-capacity scenarios, not a prediction of Claude's execution rate. Track owner time separately. If the personal pilot already solves your problem, **stop after A** and use it.

## Priority rules

1. **First:** complete groomed pilot-prep #26 → #27 → #28, then owner-only #18 click-through and #14 sign-off. Do not treat automated tests as a real personal pilot.
2. **Then:** #20 signal quality before adding model-based intelligence. Handle safety bug #21 before wider adoption.
3. **Next:** #22 cross-platform coverage before claiming broad VS Code compatibility.
4. **Optional:** #23–#25 only if the owner finds the utility worth sharing.
5. **Parked:** #15 AI provider spike and #16 remote integration spike until privacy, cost, and organizational boundaries are approved.

## How to track it in GitHub Projects

Project [#8](https://github.com/users/krunchyMonkey/projects/8) already exists. On Windows, rerun `scripts/create-project-board.ps1` using authenticated `gh` to sync pilot items and field estimates (see [PROJECT-BOARD.md](PROJECT-BOARD.md)). It builds a **repository-linked GitHub Project** with Release, Priority, Decision, Effort (h), and Owner attention (h) fields. It will reuse an identically titled project on subsequent runs; see [PROJECT-BOARD.md](PROJECT-BOARD.md). A human can create Board and Roadmap views from the fields. The connected GitHub app cannot create GitHub Projects directly.

Each week: review issue state and PRs, decide **Committed / Candidate / Optional / Parked**, update remaining hours rather than counting completed effort again, and adjust the next window. Use `planning/PROGRESS.md` for verifiable implementation results; it is not itself the roadmap.

## Enterprise fork

Do not mix proprietary source, transcripts, organization tokens or work tickets into this public repository. An internal fork needs an independent approval, allowed provider/storage design and security review (see [ENTERPRISE-FORK.md](ENTERPRISE-FORK.md)).