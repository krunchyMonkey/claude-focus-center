import * as vscode from 'vscode';
import { planResume } from '../adapters/claudeCli/resume';
import type { StateService } from '../storage/stateService';
import { itemDetailsMarkdown, sessionDetailsMarkdown } from './details';

export const DETAILS_SCHEME = 'focus-center';

/** Read-only virtual Markdown documents: focus-center:/item/<id>.md and focus-center:/session/<id>.md */
export class DetailsProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly open = new Set<string>();

  constructor(private readonly service: StateService) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
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

export interface ResumeOutcome {
  launched: boolean;
  reason?: string;
  cwd?: string;
  shellPath?: string;
  shellArgs?: string[] | string;
}

export function registerSessionCommands(service: StateService): vscode.Disposable[] {
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
    terminal.show();
    return { launched: true, cwd: plan.cwd, shellPath: plan.shellPath, shellArgs: plan.shellArgs };
  };

  return [
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
