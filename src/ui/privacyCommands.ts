import * as vscode from 'vscode';
import { emptyState } from '../domain/state/types';
import { deleteData, planDeletion } from '../storage/deleteData';
import type { StateService } from '../storage/stateService';
import { requireWriter } from './writeGuard';

export interface PrivacyHooks {
  storageDir: string;
  hooksInstalled: () => Promise<boolean>;
  /** Clears in-memory read positions etc. after deletion. */
  afterDelete: () => void;
  /**
   * Runs `task` with ingestion, refreshes and saves quiesced, so no in-flight write can recreate
   * deleted data.
   */
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
}

export function registerPrivacyCommands(service: StateService, hooks: PrivacyHooks): vscode.Disposable[] {
  const setPaused = async (paused: boolean): Promise<void> => {
    await vscode.workspace.getConfiguration('focusCenter').update('paused', paused, vscode.ConfigurationTarget.Global);
  };

  const deleteAll = async (arg?: unknown): Promise<{ removed: string[]; paused: boolean }> => {
    if (!requireWriter(service, 'delete Focus Center data')) {
      return { removed: [], paused: false };
    }
    const keepHookScripts = await hooks.hooksInstalled();
    const plan = await planDeletion(hooks.storageDir, keepHookScripts);
    // `{ confirmed: 'delete' | 'delete-and-pause' }` lets tests skip the modal; the palette passes nothing.
    const preset = (arg as { confirmed?: unknown } | undefined)?.confirmed;
    let choice: string | undefined = preset === 'delete' ? 'Delete' : preset === 'delete-and-pause' ? 'Delete and Pause Monitoring' : undefined;
    if (!choice) {
      const detail = [
        plan.paths.length ? `Removes:\n${plan.paths.map((p) => `• ${p}`).join('\n')}` : 'There is no Focus Center data to remove.',
        'Claude Code transcripts and settings are not touched.',
        keepHookScripts ? 'Hooks are installed, so the hook script is kept. Use "Disable Claude Hooks" to remove them.' : '',
        'If monitoring continues, Focus Center rebuilds its view from your current sessions.',
      ].filter(Boolean).join('\n\n');
      choice = await vscode.window.showWarningMessage('Delete Focus Center data?', { modal: true, detail }, 'Delete', 'Delete and Pause Monitoring');
    }
    if (!choice) {
      return { removed: [], paused: false };
    }
    const pause = choice === 'Delete and Pause Monitoring';
    if (pause) {
      await setPaused(true);
    }
    const removed = await hooks.runExclusive(async () => {
      const deleted = await deleteData(plan, hooks.storageDir);
      service.reset(emptyState());
      hooks.afterDelete();
      return deleted;
    });
    void vscode.window.showInformationMessage(`Deleted ${removed.length} Focus Center item(s) from local storage.${pause ? ' Monitoring is paused.' : ''}`);
    return { removed, paused: pause };
  };

  return [
    vscode.commands.registerCommand('focusCenter.pauseMonitoring', () => setPaused(true)),
    vscode.commands.registerCommand('focusCenter.resumeMonitoring', () => setPaused(false)),
    vscode.commands.registerCommand('focusCenter.deleteData', deleteAll),
  ];
}
