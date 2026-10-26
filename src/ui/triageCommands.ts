import * as vscode from 'vscode';
import { effectiveStatus } from '../domain/attention/effective';
import { tomorrowMorning, triage, TriageAction, TriageResult } from '../domain/attention/triage';
import type { StateService } from '../storage/stateService';

/** Acknowledge / Snooze / Mark Resolved / Reopen. Each accepts a tree node, an item id, or asks. */
export function registerTriageCommands(service: StateService, onChanged: () => void): vscode.Disposable[] {
  const run = (action: TriageAction, pickFilter: (status: string) => boolean) => async (arg?: unknown, until?: unknown): Promise<TriageResult> => {
    const itemId = itemIdFrom(arg) ?? (await pickItem(service, pickFilter));
    if (!itemId) {
      return { ok: false, message: 'cancelled' };
    }
    let snoozeUntil: Date | undefined;
    if (action === 'snooze') {
      snoozeUntil = typeof until === 'string' ? new Date(until) : await pickSnooze();
      if (!snoozeUntil) {
        return { ok: false, message: 'cancelled' };
      }
    }
    let result: TriageResult = { ok: false, message: 'not run' };
    service.update((state) => {
      result = triage(state, itemId, action, new Date(), snoozeUntil);
    });
    if (!result.ok) {
      void vscode.window.showWarningMessage(result.message);
    }
    onChanged();
    return result;
  };
  const open = (s: string) => s !== 'resolved';
  return [
    vscode.commands.registerCommand('focusCenter.acknowledge', run('acknowledge', open)),
    vscode.commands.registerCommand('focusCenter.snooze', run('snooze', open)),
    vscode.commands.registerCommand('focusCenter.resolve', run('resolve', open)),
    vscode.commands.registerCommand('focusCenter.reopen', run('reopen', (s) => s === 'resolved' || s === 'waiting')),
  ];
}

async function pickSnooze(): Promise<Date | undefined> {
  const now = Date.now();
  const choices = [
    { label: '1 hour', until: new Date(now + 3600_000) },
    { label: '4 hours', until: new Date(now + 4 * 3600_000) },
    { label: 'Until tomorrow', description: '09:00', until: tomorrowMorning(new Date(now)) },
  ];
  return (await vscode.window.showQuickPick(choices, { placeHolder: 'Snooze until…' }))?.until;
}

async function pickItem(service: StateService, filter: (status: string) => boolean): Promise<string | undefined> {
  const now = new Date();
  const items = Object.values(service.state.items).filter((i) => filter(effectiveStatus(i, now)));
  const picked = await vscode.window.showQuickPick(
    items.map((i) => ({ label: i.title, description: effectiveStatus(i, now), itemId: i.id })),
    { placeHolder: 'Which item?' },
  );
  return picked?.itemId;
}

function itemIdFrom(arg: unknown): string | undefined {
  if (typeof arg === 'string') {
    return arg;
  }
  const id = (arg as { itemId?: unknown } | undefined)?.itemId;
  return typeof id === 'string' ? id : undefined;
}
