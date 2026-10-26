// Curated synthetic attention scenarios. Each lists normalized events (as adapters would produce
// them) and the expected attention outcome. All content is invented.
import { normalizeSpoolRecord } from '../../domain/events/hook';
import { normalizeTranscriptLine } from '../../domain/events/transcript';
import type { NormalizedEvent } from '../../domain/events/types';
import type { AttentionItem } from '../../domain/state/types';
import { toSpoolRecord } from '../../hook/spoolRecord';

export const SCENARIO_NOW = new Date('2026-05-04T12:00:00.000Z');

export interface Expectation {
  kind: AttentionItem['kind'];
  status: AttentionItem['status'];
}

export interface Scenario {
  name: string;
  events: NormalizedEvent[];
  /** Exactly these items must exist (any order). */
  expect: Expectation[];
}

let clock = 0;
/** Minutes before SCENARIO_NOW, as ISO. */
function at(minutesAgo: number): string {
  return new Date(SCENARIO_NOW.getTime() - minutesAgo * 60_000).toISOString();
}

function hook(sessionId: string, minutesAgo: number, payload: Record<string, unknown>): NormalizedEvent {
  const raw = JSON.stringify({ session_id: sessionId, cwd: '/synthetic/repo', nonce: clock++, ...payload });
  const record = toSpoolRecord(raw, undefined, new Date(at(minutesAgo)));
  const result = normalizeSpoolRecord(record);
  if (!result.ok) {
    throw new Error(`bad hook fixture ${raw}`);
  }
  return result.event;
}

function line(sessionId: string, minutesAgo: number, record: Record<string, unknown>): NormalizedEvent[] {
  return normalizeTranscriptLine(sessionId, JSON.stringify({ uuid: `u${clock++}`, timestamp: at(minutesAgo), sessionId, cwd: '/synthetic/repo', ...record })).events;
}

const say = (s: string, m: number, text: string, extra: object = {}) => line(s, m, { type: 'assistant', message: { content: [{ type: 'text', text }] }, ...extra });
const toolUse = (s: string, m: number, name = 'Bash') => line(s, m, { type: 'assistant', message: { content: [{ type: 'tool_use', id: `toolu_${clock}`, name, input: {} }] } });
const toolResult = (s: string, m: number, isError = false) => line(s, m, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${clock}`, is_error: isError, content: isError ? 'Exit code 1' : 'ok' }] } });
const prompt = (s: string, m: number) => line(s, m, { type: 'user', message: { content: 'Synthetic prompt.' } });

export function scenarios(): Scenario[] {
  return [
    {
      name: '01 pending permission request',
      events: [...toolUse('s01', 3), hook('s01', 2, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } })],
      expect: [{ kind: 'permission', status: 'needs-you' }],
    },
    {
      name: '02 permission answered: tool result follows',
      events: [hook('s02', 5, { hook_event_name: 'PermissionRequest', tool_name: 'Edit' }), ...toolResult('s02', 4)],
      expect: [{ kind: 'permission', status: 'resolved' }],
    },
    {
      name: '03 PermissionRequest and its permission_prompt notification are one item',
      events: [
        hook('s03', 2, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
        hook('s03', 2, { hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' }),
      ],
      expect: [{ kind: 'permission', status: 'needs-you' }],
    },
    {
      name: '04 turn ends with an explicit question',
      events: [...say('s04', 3, 'I fixed the parser.\n\nShould I also migrate the old config files?'), hook('s04', 3, { hook_event_name: 'Stop', last_assistant_message: 'I fixed the parser.\n\nShould I also migrate the old config files?' })],
      expect: [{ kind: 'decision', status: 'needs-you' }],
    },
    {
      name: '05 Stop with a completion claim creates nothing and resolves nothing',
      events: [...say('s05', 3, 'All done — the refactor is complete and tests pass.'), hook('s05', 3, { hook_event_name: 'Stop', last_assistant_message: 'All done — the refactor is complete and tests pass.' })],
      expect: [],
    },
    {
      name: '06 rhetorical question mid-turn, Claude continues',
      events: [...say('s06', 6, 'Which file defines the router? Let me search for it.'), ...toolUse('s06', 6)],
      expect: [],
    },
    {
      name: '07 question answered by the user',
      events: [...say('s07', 10, 'Do you want me to keep the legacy endpoint?'), ...prompt('s07', 8)],
      expect: [{ kind: 'decision', status: 'resolved' }],
    },
    {
      name: '08 API failure stops Claude',
      events: [hook('s08', 1, { hook_event_name: 'StopFailure', error: 'rate_limit', last_assistant_message: 'API Error: Rate limit reached' })],
      expect: [{ kind: 'failure', status: 'needs-you' }],
    },
    {
      name: '09 failed command recovered before the turn ended',
      events: [...toolResult('s09', 6, true), ...toolUse('s09', 5), ...toolResult('s09', 4), hook('s09', 3, { hook_event_name: 'Stop', last_assistant_message: 'Fixed the import; tests pass now.' })],
      expect: [],
    },
    {
      name: '10 turn ended right after a failed command',
      events: [...toolResult('s10', 4, true), hook('s10', 3, { hook_event_name: 'Stop', last_assistant_message: 'The build failed.' })],
      expect: [{ kind: 'failure', status: 'uncertain' }],
    },
    {
      name: '11 task created then reported complete',
      events: [
        hook('s11', 9, { hook_event_name: 'TaskCreated', task_id: 't1', task_subject: 'Add login endpoint' }),
        hook('s11', 4, { hook_event_name: 'TaskCompleted', task_id: 't1', task_subject: 'Add login endpoint' }),
      ],
      expect: [{ kind: 'task', status: 'resolved' }],
    },
    {
      name: '12 task reported complete does not hide a newer permission request',
      events: [
        hook('s12', 9, { hook_event_name: 'TaskCreated', task_id: 't2', task_subject: 'Migrate schema' }),
        hook('s12', 5, { hook_event_name: 'TaskCompleted', task_id: 't2', task_subject: 'Migrate schema' }),
        hook('s12', 2, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
      ],
      expect: [{ kind: 'task', status: 'resolved' }, { kind: 'permission', status: 'needs-you' }],
    },
    {
      name: '13 explicit review request',
      events: [hook('s13', 2, { hook_event_name: 'Stop', last_assistant_message: 'I opened the draft PR with the changes. Please review the diff before I merge.' })],
      expect: [{ kind: 'review', status: 'needs-you' }],
    },
    {
      name: '14 question from 30 days ago is not raised',
      events: [...say('s14', 30 * 24 * 60, 'Should I delete the old branch?')],
      expect: [],
    },
    {
      name: '15 subagent question is not addressed to the user',
      events: [...say('s15', 2, 'Should I search the tests folder too?', { isSidechain: true })],
      expect: [],
    },
    {
      name: '16 session ended while a permission was pending',
      events: [hook('s16', 5, { hook_event_name: 'PermissionRequest', tool_name: 'Write' }), hook('s16', 4, { hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' })],
      expect: [{ kind: 'permission', status: 'uncertain' }],
    },
    {
      name: '17 transcript only: closing question with no hooks',
      events: [...prompt('s17', 20), ...toolUse('s17', 19), ...toolResult('s17', 18), ...say('s17', 17, 'Option A keeps the cache, option B drops it. Which approach do you prefer?')],
      expect: [{ kind: 'decision', status: 'needs-you' }],
    },
    {
      name: '18 hook arrives after the transcript shows the permission was already answered',
      events: [...toolResult('s18', 1), hook('s18', 2, { hook_event_name: 'PermissionRequest', tool_name: 'Bash' })],
      expect: [{ kind: 'permission', status: 'resolved' }],
    },
    {
      name: '19 question inside a code block is ignored',
      events: [...say('s19', 2, 'Here is the prompt text:\n```\nShould I continue? (y/n)\n```\nI added it to the CLI.')],
      expect: [],
    },
    {
      name: '20 idle notification alone does not need you',
      events: [hook('s20', 2, { hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' })],
      expect: [],
    },
  ];
}
