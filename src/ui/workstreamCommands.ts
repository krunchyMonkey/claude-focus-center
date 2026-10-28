import * as vscode from 'vscode';
import { linkSession, linkToNewWorkstream, unlinkSession } from '../domain/workstreams/group';
import type { FocusState } from '../domain/state/types';
import type { StateService } from '../storage/stateService';
import { requireWriter } from './writeGuard';

/**
 * Manual grouping commands. Each takes an optional session id (from a tree item, issue 09) and
 * otherwise asks with a quick pick. Choices are stored as manual links that survive re-imports.
 */
export function registerWorkstreamCommands(service: StateService, onChanged: () => void): vscode.Disposable[] {
  const link = async (arg?: unknown): Promise<void> => {
    if (!requireWriter(service, 'link sessions')) {
      return;
    }
    const sessionId = sessionIdFrom(arg) ?? (await pickSession(service.state, 'Link which session?'));
    if (!sessionId) {
      return;
    }
    const current = Object.values(service.state.workstreams).find((w) => w.sessionIds.includes(sessionId));
    type Target = vscode.QuickPickItem & { id?: string; action?: 'new' | 'separate' };
    const targets: Target[] = [
      { label: '$(add) New workstream…', action: 'new' },
      { label: '$(split-horizontal) Keep this session separate', action: 'separate' },
      ...Object.values(service.state.workstreams)
        .filter((w) => w.id !== current?.id)
        .map((w) => ({ label: w.title, description: `${w.sessionIds.length} session(s) · ${w.basis}`, id: w.id })),
    ];
    const target = await vscode.window.showQuickPick(targets, { placeHolder: 'Link to which workstream?' });
    if (!target) {
      return;
    }
    if (target.action === 'new') {
      const title = await vscode.window.showInputBox({ prompt: 'Name for the new workstream', validateInput: (v) => (v.trim() ? undefined : 'Enter a name') });
      if (!title) {
        return;
      }
      service.update((state) => linkToNewWorkstream(state, sessionId, title, new Date()));
    } else {
      const id = target.action === 'separate' ? `session:${sessionId}` : target.id!;
      service.update((state) => linkSession(state, sessionId, id, new Date()));
    }
    onChanged();
  };

  const unlink = async (arg?: unknown): Promise<void> => {
    if (!requireWriter(service, 'change session grouping')) {
      return;
    }
    const linked = Object.keys(service.state.manualLinks);
    if (linked.length === 0) {
      void vscode.window.showInformationMessage('No sessions have manual grouping.');
      return;
    }
    const sessionId = sessionIdFrom(arg) ?? (await pickSession(service.state, 'Restore automatic grouping for which session?', linked));
    if (!sessionId) {
      return;
    }
    service.update((state) => unlinkSession(state, sessionId, new Date()));
    onChanged();
  };

  return [
    vscode.commands.registerCommand('focusCenter.linkSession', link),
    vscode.commands.registerCommand('focusCenter.unlinkSession', unlink),
  ];
}

async function pickSession(state: FocusState, placeHolder: string, only?: string[]): Promise<string | undefined> {
  const sessions = Object.values(state.sessions)
    .filter((s) => !only || only.includes(s.sessionId))
    .sort((a, b) => (b.lastEventAt ?? b.lastSeenAt).localeCompare(a.lastEventAt ?? a.lastSeenAt));
  const picked = await vscode.window.showQuickPick(
    sessions.map((s) => ({ label: s.cwd ? s.cwd.split(/[\\/]/).pop() ?? s.cwd : 'Unknown project', description: [s.gitBranch, s.sessionId.slice(0, 8)].filter(Boolean).join(' · '), sessionId: s.sessionId })),
    { placeHolder, matchOnDescription: true },
  );
  return picked?.sessionId;
}

/** Accepts a session id string or a tree node carrying one. */
function sessionIdFrom(arg: unknown): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  }
  const candidate = (arg as { sessionId?: unknown } | undefined)?.sessionId;
  return typeof candidate === 'string' ? candidate : undefined;
}
