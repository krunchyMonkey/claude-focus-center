// Pure merge/removal of Focus Center hook entries in a Claude Code settings object.
// Entries owned by anyone else are never modified, reordered or removed.

/** File name of the hook script; its presence in a handler's args marks the entry as ours. */
export const HOOK_SCRIPT_NAME = 'claude-focus-center-hook.js';

/**
 * High-signal events (names checked against https://code.claude.com/docs/en/hooks, 2026-10-26).
 * All are registered async, so the hook can never block Claude or decide a permission.
 */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'PermissionRequest',
  'PostToolUseFailure',
  'TaskCreated',
  'TaskCompleted',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface HookCommand {
  /** Absolute path to a node executable (exec form: no shell is involved). */
  nodePath: string;
  /** Absolute path to the installed hook script. */
  scriptPath: string;
}

export class UnexpectedSettingsError extends Error {
  override readonly name = 'UnexpectedSettingsError';
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Settings = { [key: string]: Json };

export function ourHandler(cmd: HookCommand, event: HookEvent): { [key: string]: Json } {
  return { type: 'command', command: cmd.nodePath, args: [cmd.scriptPath, event], async: true };
}

export function isOwnedHandler(handler: unknown): boolean {
  if (!isObject(handler) || handler.type !== 'command') {
    return false;
  }
  const args = handler.args;
  const command = handler.command;
  const mentions = (s: unknown) => typeof s === 'string' && baseName(s) === HOOK_SCRIPT_NAME;
  return (Array.isArray(args) && args.some(mentions)) || (typeof command === 'string' && command.includes(HOOK_SCRIPT_NAME));
}

/** Returns a new settings object with exactly one Focus Center handler per event. */
export function installHooks(settings: Settings, cmd: HookCommand, events: readonly HookEvent[] = HOOK_EVENTS): Settings {
  // Never overwrite configuration we do not understand.
  if (settings.hooks !== undefined && !isObject(settings.hooks)) {
    throw new UnexpectedSettingsError('"hooks" is not an object');
  }
  for (const event of events) {
    const value = settings.hooks?.[event];
    if (value !== undefined && !Array.isArray(value)) {
      throw new UnexpectedSettingsError(`"hooks.${event}" is not an array`);
    }
  }
  const next = removeHooks(settings).settings;
  const hooks = isObject(next.hooks) ? { ...next.hooks } : {};
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? [...(hooks[event] as Json[])] : [];
    groups.push({ hooks: [ourHandler(cmd, event)] });
    hooks[event] = groups;
  }
  return { ...next, hooks };
}

export interface RemoveResult {
  settings: Settings;
  removed: number;
}

/**
 * Removes every Focus Center handler. Containers (matcher groups, event arrays, the `hooks`
 * object) are dropped only when removing our handler left them empty.
 */
export function removeHooks(settings: Settings): RemoveResult {
  if (!isObject(settings.hooks)) {
    return { settings, removed: 0 };
  }
  let removed = 0;
  const hooks: { [key: string]: Json } = {};
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[event] = groups;
      continue;
    }
    const keptGroups: Json[] = [];
    let touched = false;
    for (const group of groups) {
      if (!isObject(group) || !Array.isArray(group.hooks)) {
        keptGroups.push(group);
        continue;
      }
      const kept = group.hooks.filter((h) => !isOwnedHandler(h));
      const n = group.hooks.length - kept.length;
      if (n === 0) {
        keptGroups.push(group);
        continue;
      }
      removed += n;
      touched = true;
      if (kept.length > 0) {
        keptGroups.push({ ...group, hooks: kept });
      }
    }
    if (!touched || keptGroups.length > 0) {
      hooks[event] = touched ? keptGroups : groups;
    }
  }
  if (removed === 0) {
    return { settings, removed: 0 };
  }
  const next: Settings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
  }
  return { settings: next, removed };
}

/** Events that currently have a Focus Center handler. */
export function installedEvents(settings: Settings): string[] {
  if (!isObject(settings.hooks)) {
    return [];
  }
  return Object.entries(settings.hooks)
    .filter(([, groups]) => Array.isArray(groups) && groups.some((g) => isObject(g) && Array.isArray(g.hooks) && g.hooks.some(isOwnedHandler)))
    .map(([event]) => event);
}

function isObject(value: unknown): value is { [key: string]: Json } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
