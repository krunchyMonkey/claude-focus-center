// Deterministic, conservative session → workstream grouping (docs/MVP-SPEC.md "Cross-session grouping").
// Precedence: manual link > exact work-item ref > same repo root + branch > the session alone.
import { journal } from '../state/reducer';
import type { FocusState, SessionRecord, Workstream } from '../state/types';
import { refsFromBranch, refsFromText, WorkItemRef } from './refs';

/** Prefix of a manual workstream created by the user; `session:<id>` pins a session on its own. */
export const MANUAL_PREFIX = 'manual:';

/** Recomputes `state.workstreams` and every item's `workstreamId`. Pure function of state. */
export function regroup(state: FocusState, platform: NodeJS.Platform = process.platform): void {
  const members = new Map<string, { basis: Workstream['basis']; title: string; sessionIds: string[]; notes: Set<string> }>();
  const sessionToWorkstream = new Map<string, string>();

  for (const session of Object.values(state.sessions).sort((a, b) => a.sessionId.localeCompare(b.sessionId))) {
    const { id, basis, title, notes } = assign(state, session, platform);
    sessionToWorkstream.set(session.sessionId, id);
    const entry = members.get(id) ?? { basis, title, sessionIds: [], notes: new Set<string>() };
    entry.sessionIds.push(session.sessionId);
    notes.forEach((n) => entry.notes.add(n));
    members.set(id, entry);
  }

  const workstreams: Record<string, Workstream> = {};
  for (const [id, m] of [...members].sort(([a], [b]) => a.localeCompare(b))) {
    const conflicts = [...m.notes, ...statusConflicts(state, m.sessionIds)];
    workstreams[id] = { id, title: m.title, sessionIds: m.sessionIds, basis: m.basis, ...(conflicts.length ? { conflicts } : {}) };
  }
  state.workstreams = workstreams;
  for (const item of Object.values(state.items)) {
    const ws = sessionToWorkstream.get(item.sourceSessionIds[0]);
    if (ws) {
      item.workstreamId = ws;
    }
  }
}

function assign(state: FocusState, s: SessionRecord, platform: NodeJS.Platform): { id: string; basis: Workstream['basis']; title: string; notes: string[] } {
  const repoKey = repoKeyOf(s, platform);
  const repoName = displayRepo(s);
  const manual = state.manualLinks[s.sessionId];
  if (manual) {
    return { id: manual, basis: 'manual', title: manualTitle(state, manual, repoName), notes: [] };
  }
  const refs = workItemRefs(s, repoKey);
  if (refs.length > 0) {
    // Several distinct refs on one session is a conflict worth showing; the first (branch) wins.
    const notes = refs.length > 1 ? [`Session ${short(s.sessionId)} references ${refs.map((r) => r.label).join(' and ')}; grouped by ${refs[0].label}.`] : [];
    return { id: `ref:${refs[0].key}`, basis: 'work-item', title: `${refs[0].label}${repoName ? ` · ${repoName}` : ''}`, notes };
  }
  if (repoKey && s.gitBranch) {
    return { id: `repo:${repoKey}@${s.gitBranch}`, basis: 'repo-branch', title: `${repoName} · ${s.gitBranch}`, notes: [] };
  }
  return { id: `session:${s.sessionId}`, basis: 'session', title: `${repoName || 'Unknown project'} · session ${short(s.sessionId)}`, notes: [] };
}

function workItemRefs(s: SessionRecord, repoKey: string | undefined): WorkItemRef[] {
  const refs = [...(s.gitBranch ? refsFromBranch(s.gitBranch, repoKey) : [])];
  for (const text of s.workItemHints ?? []) {
    for (const r of refsFromText(text, repoKey)) {
      if (!refs.some((x) => x.key === r.key)) {
        refs.push(r);
      }
    }
  }
  return refs;
}

/** Sessions in one workstream that disagree: one reports completion while another still needs you. */
function statusConflicts(state: FocusState, sessionIds: string[]): string[] {
  if (sessionIds.length < 2) {
    return [];
  }
  const items = Object.values(state.items).filter((i) => sessionIds.includes(i.sourceSessionIds[0]));
  const done = items.filter((i) => i.kind === 'task' && i.status === 'resolved');
  const open = items.filter((i) => i.status === 'needs-you' || i.status === 'uncertain');
  const doneSessions = new Set(done.map((i) => i.sourceSessionIds[0]));
  const openSessions = new Set(open.map((i) => i.sourceSessionIds[0]));
  const conflicting = [...doneSessions].some((d) => [...openSessions].some((o) => o !== d));
  return conflicting ? ['One session reports its task complete while another still has open items.'] : [];
}

/** Canonical repo identity: repo root when known, else cwd. Case-folded where the file system usually is. */
export function repoKeyOf(s: Pick<SessionRecord, 'repoRoot' | 'cwd'>, platform: NodeJS.Platform = process.platform): string | undefined {
  const root = s.repoRoot ?? s.cwd;
  if (!root) {
    return undefined;
  }
  const normalized = root.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return platform === 'win32' || platform === 'darwin' ? normalized.toLowerCase() : normalized;
}

function displayRepo(s: SessionRecord): string {
  const root = s.repoRoot ?? s.cwd;
  return root ? root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? root : '';
}

function manualTitle(state: FocusState, id: string, repoName: string): string {
  if (id.startsWith('session:')) {
    return `${repoName || 'Unknown project'} · session ${short(id.slice('session:'.length))} (kept separate)`;
  }
  return state.manualWorkstreamTitles?.[id] ?? id.slice(MANUAL_PREFIX.length);
}

function short(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/** Links a session to a workstream (existing id, `session:<id>` to keep it separate). Recorded as a user action. */
export function linkSession(state: FocusState, sessionId: string, workstreamId: string, now: Date, platform: NodeJS.Platform = process.platform): void {
  if (!state.sessions[sessionId]) {
    throw new Error(`Unknown session ${sessionId}`);
  }
  state.manualLinks[sessionId] = workstreamId;
  userAction(state, now, sessionId, `Linked session ${short(sessionId)} to ${state.workstreams[workstreamId]?.title ?? workstreamId}`);
  regroup(state, platform);
}

/** Creates a named workstream and links the session to it. Returns the new id. */
export function linkToNewWorkstream(state: FocusState, sessionId: string, title: string, now: Date, platform: NodeJS.Platform = process.platform): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workstream';
  let id = `${MANUAL_PREFIX}${slug}`;
  for (let n = 2; state.workstreams[id] || state.manualWorkstreamTitles?.[id]; n++) {
    id = `${MANUAL_PREFIX}${slug}-${n}`;
  }
  state.manualWorkstreamTitles = { ...(state.manualWorkstreamTitles ?? {}), [id]: title.trim().slice(0, 80) || 'Workstream' };
  linkSession(state, sessionId, id, now, platform);
  return id;
}

/** Removes the manual link so automatic grouping applies again. */
export function unlinkSession(state: FocusState, sessionId: string, now: Date, platform: NodeJS.Platform = process.platform): boolean {
  if (!(sessionId in state.manualLinks)) {
    return false;
  }
  delete state.manualLinks[sessionId];
  userAction(state, now, sessionId, `Removed manual grouping for session ${short(sessionId)}`);
  regroup(state, platform);
  return true;
}

function userAction(state: FocusState, now: Date, sessionId: string, summary: string): void {
  journal(state, now, { type: 'user-action', sessionId, summary });
}
