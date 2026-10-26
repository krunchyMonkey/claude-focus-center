// Structural validation of a loaded state file. Focus Center wrote it, but the file can be corrupted,
// hand-edited or written by another version, so it is checked before use.
import { FocusState, STATE_SCHEMA_VERSION } from '../domain/state/types';

export type ValidateResult =
  | { ok: true; state: FocusState }
  | { ok: false; reason: 'not-object' | 'newer-version' | 'unknown-version' | 'invalid-shape'; detail: string };

export function validateState(value: unknown): ValidateResult {
  if (!isObject(value)) {
    return { ok: false, reason: 'not-object', detail: 'state file does not contain a JSON object' };
  }
  const version = value.schemaVersion;
  if (typeof version === 'number' && version > STATE_SCHEMA_VERSION) {
    return { ok: false, reason: 'newer-version', detail: `state schema ${version} is newer than supported ${STATE_SCHEMA_VERSION}` };
  }
  if (version !== STATE_SCHEMA_VERSION) {
    return { ok: false, reason: 'unknown-version', detail: `unsupported state schema ${String(version)}` };
  }
  const problems: string[] = [];
  for (const key of ['sessions', 'items', 'workstreams', 'manualLinks', 'cursors'] as const) {
    if (!isObject(value[key])) {
      problems.push(`${key} is not an object`);
    }
  }
  for (const key of ['processedEventIds', 'journal'] as const) {
    if (!Array.isArray(value[key])) {
      problems.push(`${key} is not an array`);
    }
  }
  for (const key of ['nextSeq', 'checkpointSeq'] as const) {
    if (!Number.isInteger(value[key]) || (value[key] as number) < 0) {
      problems.push(`${key} is not a non-negative integer`);
    }
  }
  if (problems.length === 0) {
    if (!(value.processedEventIds as unknown[]).every((id) => typeof id === 'string')) {
      problems.push('processedEventIds contains non-strings');
    }
    for (const [id, item] of Object.entries(value.items as Record<string, unknown>)) {
      if (!isObject(item) || item.id !== id || !Array.isArray(item.evidence) || typeof item.status !== 'string') {
        problems.push(`item ${id} is malformed`);
        break;
      }
    }
    for (const [id, s] of Object.entries(value.sessions as Record<string, unknown>)) {
      if (!isObject(s) || s.sessionId !== id) {
        problems.push(`session ${id} is malformed`);
        break;
      }
    }
  }
  if (problems.length > 0) {
    return { ok: false, reason: 'invalid-shape', detail: problems.join('; ') };
  }
  return { ok: true, state: value as unknown as FocusState };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
