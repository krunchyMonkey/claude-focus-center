// File I/O around settings.ts: opt-in install/uninstall of Focus Center hooks in the user's Claude
// Code settings. Every write is preceded by a backup, is atomic, and aborts if the file changed
// since it was read. Unparseable settings are never touched.
import { constants as fsConstants, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { HOOK_SCRIPT_NAME, HookCommand, installedEvents, installHooks, removeHooks, Settings } from './settings';

export class SettingsUnreadableError extends Error {
  override readonly name = 'SettingsUnreadableError';
}
export class SettingsChangedError extends Error {
  override readonly name = 'SettingsChangedError';
}

/** User-level Claude Code settings, honouring CLAUDE_CONFIG_DIR. */
export function defaultSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  return path.join(configDir ? configDir : path.join(os.homedir(), '.claude'), 'settings.json');
}

/** Stable location for the hook script, independent of the (versioned) extension folder. */
export function installedScriptPath(storageDir: string): string {
  return path.join(storageDir, 'hooks', HOOK_SCRIPT_NAME);
}

/** Where hooks drop one JSON file per event. */
export function spoolDirFor(storageDir: string): string {
  return path.join(storageDir, 'spool');
}

/** Copies the dependency-free hook folder (the script and its sibling modules) into storage. */
export async function copyHookScripts(sourceDir: string, storageDir: string): Promise<string> {
  const target = path.dirname(installedScriptPath(storageDir));
  await fs.mkdir(target, { recursive: true });
  const files = (await fs.readdir(sourceDir)).filter((f) => f.endsWith('.js'));
  if (!files.includes(HOOK_SCRIPT_NAME)) {
    throw new Error(`Hook script ${HOOK_SCRIPT_NAME} not found in ${sourceDir}`);
  }
  for (const file of files) {
    await fs.copyFile(path.join(sourceDir, file), path.join(target, file));
  }
  return installedScriptPath(storageDir);
}

interface LoadedSettings {
  exists: boolean;
  text?: string;
  settings: Settings;
}

export async function loadSettings(settingsPath: string): Promise<LoadedSettings> {
  let text: string;
  try {
    text = await fs.readFile(settingsPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, settings: {} };
    }
    throw new SettingsUnreadableError(`Cannot read ${settingsPath}: ${(err as NodeJS.ErrnoException).code ?? err}`);
  }
  if (text.trim() === '') {
    return { exists: true, text, settings: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch {
    throw new SettingsUnreadableError(`${settingsPath} is not valid JSON; it was left unchanged.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SettingsUnreadableError(`${settingsPath} does not contain a JSON object; it was left unchanged.`);
  }
  return { exists: true, text, settings: parsed as Settings };
}

export interface HookChangeResult {
  changed: boolean;
  backupPath?: string;
  events: string[];
  removed?: number;
}

export interface EnableOptions {
  settingsPath: string;
  storageDir: string;
  nodePath: string;
  /** Folder with the compiled, dependency-free hook script shipped with the extension. */
  hookSourceDir: string;
  now?: Date;
}

export async function enableHooks(options: EnableOptions): Promise<HookChangeResult> {
  const scriptPath = await copyHookScripts(options.hookSourceDir, options.storageDir);

  const loaded = await loadSettings(options.settingsPath);
  const cmd: HookCommand = { nodePath: options.nodePath, scriptPath, spoolDir: spoolDirFor(options.storageDir) };
  const next = installHooks(loaded.settings, cmd);
  const result = await writeIfChanged(options.settingsPath, options.storageDir, loaded, next, options.now);
  return { ...result, events: installedEvents(next) };
}

export interface DisableOptions {
  settingsPath: string;
  storageDir: string;
  now?: Date;
}

export async function disableHooks(options: DisableOptions): Promise<HookChangeResult> {
  const loaded = await loadSettings(options.settingsPath);
  const { settings, removed } = removeHooks(loaded.settings);
  const result = removed > 0
    ? await writeIfChanged(options.settingsPath, options.storageDir, loaded, settings, options.now)
    : { changed: false };
  return { ...result, events: installedEvents(settings), removed };
}

export interface HookStatus {
  settingsPath: string;
  events: string[];
  error?: string;
}

export async function hookStatus(settingsPath: string): Promise<HookStatus> {
  try {
    return { settingsPath, events: installedEvents((await loadSettings(settingsPath)).settings) };
  } catch (err) {
    return { settingsPath, events: [], error: err instanceof Error ? err.message : String(err) };
  }
}

async function writeIfChanged(settingsPath: string, storageDir: string, loaded: LoadedSettings, next: Settings, now = new Date()): Promise<{ changed: boolean; backupPath?: string }> {
  const text = serialize(next, loaded.text);
  if (text === loaded.text) {
    return { changed: false };
  }
  let backupPath: string | undefined;
  if (loaded.exists) {
    const dir = path.join(storageDir, 'backups');
    await fs.mkdir(dir, { recursive: true });
    backupPath = path.join(dir, `claude-settings.${now.toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(backupPath, loaded.text ?? '', { encoding: 'utf8', flag: 'wx' });
  }
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  const tmp = `${settingsPath}.focus-center-${process.pid}-${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, text, { encoding: 'utf8', flag: 'wx' });
    // Abort if Claude (or the user) changed the file after we read it.
    const current = await readOrUndefined(settingsPath);
    if (current !== loaded.text) {
      throw new SettingsChangedError(`${settingsPath} changed while it was being updated; nothing was written. Try again.`);
    }
    await fs.rename(tmp, settingsPath);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return { changed: true, backupPath };
}

/** Keeps the original indentation, line endings and trailing newline where possible. */
export function serialize(settings: Settings, original: string | undefined): string {
  const indentMatch = original?.match(/^[ \t]+(?=")/m);
  const indent = indentMatch ? indentMatch[0] : 2;
  const eol = original?.includes('\r\n') ? '\r\n' : '\n';
  const trailing = original === undefined || original === '' || /\r?\n$/.test(original);
  const body = JSON.stringify(settings, null, indent).replace(/\n/g, eol);
  const bom = original?.startsWith('﻿') ? '﻿' : '';
  return bom + body + (trailing ? eol : '');
}

async function readOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

function stripBom(text: string): string {
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** Finds a node executable on PATH without running anything. */
export async function findNodeOnPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  const pathVar = env.PATH ?? env.Path ?? '';
  const impl = platform === 'win32' ? path.win32 : path.posix;
  const names = platform === 'win32' ? ['node.exe'] : ['node'];
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':')) {
    if (!dir || !impl.isAbsolute(dir)) {
      continue; // Relative PATH entries would resolve differently inside Claude's hook runner.
    }
    for (const name of names) {
      const candidate = impl.join(dir, name);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          if (platform !== 'win32') {
            await fs.access(candidate, fsConstants.X_OK);
          }
          return candidate;
        }
      } catch {
        // not here
      }
    }
  }
  return undefined;
}
