// Converts untrusted Claude Code transcript lines into NormalizedEvents. Content is treated as inert
// data: only tool names, error flags and short redacted excerpts are kept — never prompts, tool
// arguments or full command output.
import { createHash } from 'node:crypto';
import { boundedExcerpt } from './redact';
import { eventId, NormalizedEvent } from './types';

export const ASSISTANT_EXCERPT_CHARS = 400;
export const ERROR_EXCERPT_CHARS = 200;
const MAX_ID_CHARS = 128;

export interface LineParseResult {
  events: NormalizedEvent[];
  /** Line was not a JSON object. */
  invalid: boolean;
}

/** `sessionId` comes from the transcript file name, which discovery has validated. */
export function normalizeTranscriptLine(sessionId: string, line: string): LineParseResult {
  const record = parseObject(line);
  if (!record) {
    return { events: [], invalid: line.trim() !== '' };
  }

  const uuid = safeId(record.uuid);
  const baseId = uuid ?? `h:${createHash('sha256').update(line).digest('hex').slice(0, 32)}`;
  const base = {
    schema: 1 as const,
    source: 'transcript' as const,
    sessionId,
    timestamp: validTimestamp(record.timestamp),
    cwd: optionalString(record.cwd),
    gitBranch: optionalString(record.gitBranch),
    messageUuid: uuid,
    sidechain: record.isSidechain === true ? true : undefined,
  };
  const make = (suffix: string, fields: Pick<NormalizedEvent, 'kind'> & Partial<NormalizedEvent>): NormalizedEvent => {
    const sourceEventId = suffix ? `${baseId}#${suffix}` : baseId;
    return prune({ ...base, ...fields, sourceEventId, id: eventId('transcript', sessionId, sourceEventId) });
  };

  const message = asObject(record.message);
  const content = message?.content;
  const events: NormalizedEvent[] = [];

  switch (record.type) {
    case 'user': {
      if (typeof content === 'string') {
        events.push(make('', { kind: 'user-prompt' }));
        break;
      }
      blocks(content).forEach((block, i) => {
        if (block.type === 'tool_result') {
          const isError = block.is_error === true;
          events.push(make(`result:${safeId(block.tool_use_id) ?? i}`, {
            kind: 'tool-result',
            isError,
            excerpt: isError ? textOf(block.content, ERROR_EXCERPT_CHARS, 'start') : undefined,
          }));
        } else if (block.type === 'text' && !events.some((e) => e.kind === 'user-prompt')) {
          events.push(make('', { kind: 'user-prompt' }));
        }
      });
      break;
    }
    case 'assistant': {
      const parts = blocks(content);
      const text = parts.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n');
      if (text.trim()) {
        // Questions and requests usually close a message, so keep its end.
        events.push(make('text', { kind: 'assistant-text', excerpt: boundedExcerpt(text, ASSISTANT_EXCERPT_CHARS, 'end') }));
      }
      parts.forEach((block, i) => {
        if (block.type === 'tool_use') {
          events.push(make(`tool:${safeId(block.id) ?? i}`, { kind: 'tool-use', toolName: optionalString(block.name)?.slice(0, 64) }));
        }
      });
      break;
    }
    case 'system': {
      const level = optionalString(record.level);
      events.push(make('', { kind: 'system', isError: level === 'error' ? true : undefined }));
      break;
    }
    default:
      // summary, file-history-snapshot and unknown/new record types carry no attention signal yet.
      break;
  }
  return { events, invalid: false };
}

function blocks(content: unknown): Array<Record<string, unknown>> {
  return Array.isArray(content) ? content.map(asObject).filter((b): b is Record<string, unknown> => b !== undefined) : [];
}

function textOf(content: unknown, max: number, keep: 'start' | 'end'): string | undefined {
  const text = typeof content === 'string'
    ? content
    : blocks(content).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('\n');
  return text.trim() ? boundedExcerpt(text, max, keep) : undefined;
}

function parseObject(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) {
    return undefined;
  }
  try {
    return asObject(JSON.parse(trimmed));
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]+$/.test(value) ? value.slice(0, MAX_ID_CHARS) : undefined;
}

function validTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function prune<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as Array<keyof T>) {
    if (obj[key] === undefined) {
      delete obj[key];
    }
  }
  return obj;
}
