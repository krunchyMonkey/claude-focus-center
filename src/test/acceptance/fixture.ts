// Gold-path acceptance fixture (docs/MVP-SPEC.md "Gold-path demo"): 4 projects, 10 sessions with
// real (temporary) project folders, plus the hook payloads the acceptance run sends. All synthetic.
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FixtureSession, writeSessions } from '../fixtures/sessions';

export interface GoldPath {
  root: string;
  claudeConfigDir: string;
  projects: Record<'alpha' | 'beta' | 'gamma' | 'delta', string>;
  sessions: Record<string, { id: string; cwd: string; branch: string }>;
}

const ID = (n: number) => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export function goldPathLayout(root: string): GoldPath {
  const projects = {
    alpha: path.join(root, 'work', 'alpha-api'),
    beta: path.join(root, 'work', 'beta-web'),
    gamma: path.join(root, 'work', 'gamma-tools'),
    delta: path.join(root, 'personal', 'delta-docs'),
  };
  const s = (n: number, cwd: string, branch: string) => ({ id: ID(n), cwd, branch });
  return {
    root,
    claudeConfigDir: path.join(root, 'claude'),
    projects,
    sessions: {
      decision: s(1, projects.alpha, 'feat/auth'), // closing question → Needs You
      review: s(2, projects.alpha, 'feat/auth'), // review request → Needs You (same workstream as 1)
      taskBeta: s(3, projects.beta, 'feat/search'), // TaskCreated hook → In Progress
      taskGamma: s(4, projects.gamma, 'main'), // TaskCreated hook → In Progress
      snoozed: s(5, projects.beta, 'main'), // question, then snoozed → Waiting
      failed: s(6, projects.gamma, 'feature/PROJ-9-cli'), // failed tool + Stop → Uncertain
      done: s(7, projects.delta, 'docs/guide'), // TaskCompleted → Resolved (reported)
      midTurn: s(8, projects.beta, 'chore/deps'), // rhetorical mid-turn question → nothing
      answered: s(9, projects.delta, 'main'), // question answered → Resolved
      conflict: s(10, projects.delta, 'feature/PROJ-9-docs'), // completes PROJ-9 while session 6 is Uncertain
    },
  };
}

/** Writes project folders and transcripts (one of them malformed) into the layout. */
export async function writeGoldPath(g: GoldPath, now = Date.now()): Promise<void> {
  for (const dir of Object.values(g.projects)) {
    await fs.mkdir(dir, { recursive: true });
  }
  const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
  let u = 0;
  const rec = (sid: string, cwd: string, branch: string, minAgo: number, body: object) =>
    JSON.stringify({ uuid: `${sid}-u${u++}`, sessionId: sid, cwd, gitBranch: branch, timestamp: at(minAgo), version: '2.0.0', ...body });
  const user = (text: string) => ({ type: 'user', message: { role: 'user', content: text } });
  const say = (text: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  const tool = (id: string) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } });
  const result = (id: string, isError: boolean) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: isError ? 'Exit code 1\nSynthetic failure' : 'ok' }] } });

  const lines: Record<string, Array<[number, object]>> = {
    decision: [[40, user('Add token refresh.')], [38, tool('t1')], [37, result('t1', false)], [35, say('Token refresh is in place.\n\nShould I also rotate the existing signing keys?')]],
    review: [[30, user('Open a PR for the auth change.')], [25, say('I opened a draft PR with the auth changes. Please review the diff before I mark it ready.')]],
    taskBeta: [[20, user('Build the search page.')], [19, tool('t2')]],
    taskGamma: [[22, user('Refactor the CLI parser.')], [21, tool('t3')]],
    snoozed: [[50, user('Clean up the styles.')], [45, say('There are two options: keep the old theme or drop it. Which approach do you prefer?')]],
    failed: [[15, user('Publish the CLI build.')], [14, tool('t4')], [13, result('t4', true)]],
    done: [[60, user('Write the setup guide.')], [55, say('The guide is written.')]],
    midTurn: [[12, user('Update dependencies.')], [11, say('Which file pins the versions? Let me search for it.')], [11, tool('t5')], [10, result('t5', false)]],
    answered: [[90, say('Do you want me to keep the legacy page?')], [85, user('Yes, keep it.')], [84, say('Kept it.')]],
    conflict: [[70, user('Document PROJ-9.')], [65, say('Documented.')]],
  };
  const fixtures: FixtureSession[] = Object.entries(g.sessions).map(([key, s]) => ({
    sessionId: s.id,
    cwd: s.cwd,
    gitBranch: s.branch,
    mtime: Math.floor(now / 1000) - Math.min(...lines[key].map(([m]) => m)) * 60,
    lines: [
      JSON.stringify({ type: 'summary', summary: 'Synthetic', leafUuid: 'x' }),
      ...lines[key].map(([m, body]) => rec(s.id, s.cwd, s.branch, m, body)),
      // Malformed data in one transcript: garbage and a partial final line must not break anything.
      ...(key === 'midTurn' ? ['not json at all', '{"type":"assistant","message":{"content":[{"type":"text","text":"cut off'] : []),
    ],
  }));
  await writeSessions(path.join(g.claudeConfigDir, 'projects'), fixtures);
}

/** Hook payloads the acceptance run fires (as Claude Code would) during launch 1. */
export function goldPathHooks(g: GoldPath, now = Date.now()): Array<{ event: string; payload: object }> {
  const base = (key: keyof GoldPath['sessions']) => ({ session_id: g.sessions[key].id, cwd: g.sessions[key].cwd, transcript_path: 'synthetic' });
  void now;
  return [
    { event: 'TaskCreated', payload: { ...base('taskBeta'), hook_event_name: 'TaskCreated', task_id: 'search', task_subject: 'Build the search page' } },
    { event: 'TaskCreated', payload: { ...base('taskGamma'), hook_event_name: 'TaskCreated', task_id: 'parser', task_subject: 'Refactor the CLI parser' } },
    { event: 'Stop', payload: { ...base('failed'), hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'The publish step failed.' } },
    { event: 'TaskCompleted', payload: { ...base('done'), hook_event_name: 'TaskCompleted', task_id: 'guide', task_subject: 'Write the setup guide' } },
    { event: 'TaskCompleted', payload: { ...base('conflict'), hook_event_name: 'TaskCompleted', task_id: 'proj9', task_subject: 'Document PROJ-9' } },
  ];
}

/** The live permission prompt fired after the dashboard is up. */
export function permissionHook(g: GoldPath): { event: string; payload: object } {
  return {
    event: 'PermissionRequest',
    payload: { session_id: g.sessions.decision.id, cwd: g.sessions.decision.cwd, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'synthetic' } },
  };
}
