import * as vscode from 'vscode';
import { planResume } from '../adapters/claudeCli/resume';
import type { StateService } from '../storage/stateService';
import { buildRecap } from '../domain/recap/recap';
import { itemDetailsMarkdown, sessionDetailsMarkdown } from './details';
import { recapMarkdown } from './recap';

export const DETAILS_SCHEME = 'focus-center';

/** Read-only virtual Markdown documents: focus-center:/item/<id>.md and focus-center:/session/<id>.md */
export class DetailsProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly open = new Set<string>();
  /** Rendered recap text per URI: a recap is a snapshot of the range it was opened with. */
  private readonly recaps = new Map<string, string>();
  /** End of the journal range of the recap the user most recently opened (what Mark Caught Up may cover). */
  lastRecapToSeq: number | undefined;

  constructor(private readonly service: StateService) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.path === '/recap.md') {
      const key = uri.toString();
      let text = this.recaps.get(key);
      if (text === undefined) {
        const now = new Date();
        const match = /range=(\d+)-(\d+)/.exec(uri.query);
        const recap = buildRecap(this.service.state, now, match ? { fromSeq: Number(match[1]), toSeq: Number(match[2]) } : {});
        text = recapMarkdown(recap, this.service.state, now);
        this.recaps.set(key, text);
      }
      return text;
    }
    this.open.add(uri.toString());
    const [, kind, file] = uri.path.split('/');
    const id = decodeURIComponent((file ?? '').replace(/\.md$/, ''));
    return kind === 'session' ? sessionDetailsMarkdown(this.service.state, id, new Date()) : itemDetailsMarkdown(this.service.state, id, new Date());
  }

  /** Re-renders open details documents after state changes. */
  refresh(): void {
    for (const uri of this.open) {
      this.changed.fire(vscode.Uri.parse(uri));
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function detailsUri(kind: 'item' | 'session', id: string): vscode.Uri {
  return vscode.Uri.from({ scheme: DETAILS_SCHEME, path: `/${kind}/${encodeURIComponent(id)}.md` });
}

export interface FocusOutcome {
  /**
   * Which surface took focus: a terminal we launched, the Claude Code panel, or a fresh resume.
   * `prompt` means the session runs in a terminal outside VS Code, which we cannot focus; the user is asked.
   */
  via: 'terminal' | 'claude-panel' | 'resume' | 'prompt' | 'cancelled';
  reason?: string;
}

const CLAUDE_PANEL_COMMAND = 'claude-vscode.editor.open';
/** Transcript `entrypoint` of sessions started in the Claude Code panel; anything else ran in an outside CLI. */
const PANEL_ENTRYPOINT = 'claude-vscode';

export interface ResumeOutcome {
  launched: boolean;
  reason?: string;
  cwd?: string;
  shellPath?: string;
  shellArgs?: string[] | string;
}

export function registerSessionCommands(service: StateService): vscode.Disposable[] {
  /** Terminals this extension launched, so a second click focuses the live one instead of resuming again. */
  const terminals = new Map<string, vscode.Terminal>();
  const closeListener = vscode.window.onDidCloseTerminal((closed) => {
    for (const [id, terminal] of terminals) {
      if (terminal === closed) {
        terminals.delete(id);
      }
    }
  });

  const showDetails = async (arg?: unknown): Promise<void> => {
    const { itemId, sessionId } = target(arg);
    const uri = itemId ? detailsUri('item', itemId) : sessionId ? detailsUri('session', sessionId) : undefined;
    if (!uri) {
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
    await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
  };

  const resume = async (arg?: unknown): Promise<ResumeOutcome> => {
    let { sessionId } = target(arg);
    const { itemId } = target(arg);
    if (!sessionId && itemId) {
      sessionId = service.state.items[itemId]?.sourceSessionIds[0];
    }
    if (!sessionId) {
      sessionId = await pickSession(service);
    }
    if (!sessionId) {
      return { launched: false, reason: 'cancelled' };
    }
    const session = service.state.sessions[sessionId];
    if (!session) {
      void vscode.window.showErrorMessage('Focus Center no longer knows this session; it may have been excluded or deleted.');
      return { launched: false, reason: 'unknown-session' };
    }
    const configured = vscode.workspace.getConfiguration('focusCenter').get<string>('claudePath');
    const result = await planResume({ sessionId, cwd: session.cwd, transcriptPath: session.transcriptPath, configuredCli: configured });
    if (!result.ok) {
      const actions = result.displayCommand ? ['Copy Command'] : [];
      void vscode.window.showErrorMessage(`Cannot resume: ${result.message}`, ...actions).then(async (choice) => {
        if (choice === 'Copy Command' && result.displayCommand) {
          await vscode.env.clipboard.writeText(result.displayCommand);
        }
      });
      return { launched: false, reason: result.reason };
    }
    const { plan } = result;
    if (plan.warnings.length > 0) {
      const go = await vscode.window.showWarningMessage(plan.warnings.join(' '), { modal: true }, 'Resume Anyway');
      if (go !== 'Resume Anyway') {
        return { launched: false, reason: 'cancelled' };
      }
    }
    const name = `Claude · ${session.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? sessionId.slice(0, 8)}`;
    const terminal = vscode.window.createTerminal({ name, cwd: plan.cwd, shellPath: plan.shellPath, shellArgs: plan.shellArgs });
    terminals.set(sessionId, terminal);
    terminal.show();
    return { launched: true, cwd: plan.cwd, shellPath: plan.shellPath, shellArgs: plan.shellArgs };
  };

  /** Takes you to where the session lives: our terminal, else the Claude Code panel, else a new resume. */
  const focusSession = async (arg?: unknown): Promise<FocusOutcome> => {
    let { sessionId } = target(arg);
    const { itemId } = target(arg);
    if (!sessionId && itemId) {
      sessionId = service.state.items[itemId]?.sourceSessionIds[0];
    }
    if (!sessionId) {
      return { via: 'cancelled', reason: 'no-session' };
    }
    const live = terminals.get(sessionId);
    if (live) {
      live.show();
      return { via: 'terminal' };
    }
    // A session started in a plain terminal is not in a Claude panel, and opening one would fork the live
    // conversation. Focus Center cannot focus a terminal it did not launch, so say so and let the user decide.
    const entrypoint = service.state.sessions[sessionId]?.entrypoint;
    if (entrypoint !== undefined && entrypoint !== PANEL_ENTRYPOINT) {
      void vscode.window
        .showInformationMessage('This session was started in a terminal outside VS Code, so Focus Center cannot switch to it. Resuming it here would start a second copy.', 'Resume in New Terminal')
        .then((choice) => (choice ? resume(arg) : undefined));
      return { via: 'prompt', reason: 'external-cli' };
    }
    // Claude Code's panel command focuses the panel already showing this session, or opens one that loads it.
    if ((await vscode.commands.getCommands(true)).includes(CLAUDE_PANEL_COMMAND)) {
      try {
        await vscode.commands.executeCommand(CLAUDE_PANEL_COMMAND, sessionId);
        return { via: 'claude-panel' };
      } catch {
        // fall through to a terminal resume
      }
    }
    const outcome = await resume(arg);
    return outcome.launched ? { via: 'resume' } : { via: 'cancelled', reason: outcome.reason };
  };

  return [
    closeListener,
    vscode.commands.registerCommand('focusCenter.focusSession', focusSession),
    vscode.commands.registerCommand('focusCenter.showDetails', showDetails),
    vscode.commands.registerCommand('focusCenter.resumeSession', resume),
  ];
}

async function pickSession(service: StateService): Promise<string | undefined> {
  const sessions = Object.values(service.state.sessions).sort((a, b) => (b.lastEventAt ?? b.lastSeenAt).localeCompare(a.lastEventAt ?? a.lastSeenAt));
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({ label: s.cwd?.split(/[\\/]/).filter(Boolean).pop() ?? 'Unknown project', description: [s.gitBranch, s.sessionId.slice(0, 8)].filter(Boolean).join(' · '), sessionId: s.sessionId })),
    { placeHolder: 'Resume which session?', matchOnDescription: true },
  );
  return picked?.sessionId;
}

function target(arg: unknown): { itemId?: string; sessionId?: string } {
  if (typeof arg === 'string') {
    return { sessionId: arg };
  }
  const a = arg as { itemId?: unknown; sessionId?: unknown } | undefined;
  return {
    itemId: typeof a?.itemId === 'string' ? a.itemId : undefined,
    sessionId: typeof a?.sessionId === 'string' && typeof a?.itemId !== 'string' ? a.sessionId : undefined,
  };
}

/** One URI per journal range, so each Catch Me Up renders fresh instead of reusing a cached document. */
export function recapUri(fromSeq: number, toSeq: number): vscode.Uri {
  return vscode.Uri.from({ scheme: DETAILS_SCHEME, path: '/recap.md', query: `range=${fromSeq}-${toSeq}` });
}
