// Plans a safe `claude --resume <id>` launch. The CLI runs as the terminal's own process with an
// argument array, so no shell command string is ever built from session data.
import { constants as fsConstants, promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Same conservative charset discovery accepts for session file names. */
export const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export interface ResumePlan {
  cwd: string;
  shellPath: string;
  /** Argument array, or (Windows .cmd shims only) one cmd.exe command line. */
  shellArgs: string[] | string;
  /** For display / copying only; never executed as a string. */
  displayCommand: string;
  warnings: string[];
}

export type ResumeResult =
  | { ok: true; plan: ResumePlan }
  | { ok: false; reason: 'unsafe-session-id' | 'unknown-session' | 'no-cwd' | 'cwd-missing' | 'cli-missing' | 'unsafe-cli-path'; message: string; displayCommand?: string };

export interface ResumeInput {
  sessionId: string;
  cwd?: string;
  transcriptPath?: string;
  /** Explicit CLI path from settings; otherwise PATH is searched. */
  configuredCli?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export async function planResume(input: ResumeInput): Promise<ResumeResult> {
  const platform = input.platform ?? process.platform;
  if (!SAFE_SESSION_ID.test(input.sessionId)) {
    return { ok: false, reason: 'unsafe-session-id', message: 'This session ID contains unexpected characters, so it will not be passed to a terminal.' };
  }
  const displayCommand = `claude --resume ${input.sessionId}`;
  if (!input.cwd) {
    return { ok: false, reason: 'no-cwd', message: 'The working directory of this session is unknown, so it cannot be resumed in the right place.', displayCommand };
  }
  try {
    if (!(await fs.stat(input.cwd)).isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    return { ok: false, reason: 'cwd-missing', message: `The session's working directory no longer exists: ${input.cwd}`, displayCommand };
  }

  const cli = input.configuredCli?.trim() ? input.configuredCli.trim() : await findOnPath('claude', input.env ?? process.env, platform);
  if (!cli || !path.isAbsolute(cli)) {
    return { ok: false, reason: 'cli-missing', message: 'The Claude Code CLI ("claude") was not found on PATH. Install it or set "focusCenter.claudePath".', displayCommand };
  }
  try {
    await fs.access(cli, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
  } catch {
    return { ok: false, reason: 'cli-missing', message: `The configured Claude CLI is not an executable file: ${cli}`, displayCommand };
  }

  const warnings: string[] = [];
  if (input.transcriptPath) {
    try {
      await fs.stat(input.transcriptPath);
    } catch {
      warnings.push('The session transcript was not found; Claude may not be able to resume this session.');
    }
  }

  const args = ['--resume', input.sessionId];
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(cli)) {
    // npm shims need cmd.exe. Refuse paths that cmd would interpret; the id charset is already safe.
    if (/[&|<>^%!"]/.test(cli)) {
      return { ok: false, reason: 'unsafe-cli-path', message: `The Claude CLI path contains characters cmd.exe would interpret: ${cli}`, displayCommand };
    }
    const comspec = (input.env ?? process.env).ComSpec ?? 'cmd.exe';
    // `/s /c "..."`: cmd strips exactly the outer quotes, leaving `"<cli>" --resume <id>`.
    return { ok: true, plan: { cwd: input.cwd, shellPath: comspec, shellArgs: `/d /s /c ""${cli}" ${args.join(' ')}"`, displayCommand, warnings } };
  }
  return { ok: true, plan: { cwd: input.cwd, shellPath: cli, shellArgs: args, displayCommand, warnings } };
}

/** Searches absolute PATH entries without running anything. */
export async function findOnPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): Promise<string | undefined> {
  const impl = platform === 'win32' ? path.win32 : path.posix;
  const exts = platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir || !impl.isAbsolute(dir)) {
      continue;
    }
    for (const ext of exts) {
      const candidate = impl.join(dir, name + ext);
      try {
        if ((await fs.stat(candidate)).isFile()) {
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
