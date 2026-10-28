import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  defaultSettingsPath,
  disableHooks,
  enableHooks,
  findNodeOnPath,
  installedScriptPath,
  spoolDirFor,
} from '../adapters/claudeHooks/installer';
import { HOOK_EVENTS } from '../adapters/claudeHooks/settings';
import { currentScope } from './scopeConfig';

/** Registers the explicit, user-initiated hook opt-in / opt-out commands. */
export function registerHookCommands(context: vscode.ExtensionContext, onChanged: () => void): vscode.Disposable[] {
  const storageDir = context.globalStorageUri.fsPath;
  const hookSourceDir = context.asAbsolutePath(path.join('out', 'hook'));

  const enable = async (): Promise<void> => {
    const settingsPath = defaultSettingsPath();
    const nodePath = await resolveNode();
    if (!nodePath) {
      void vscode.window.showErrorMessage(
        'Focus Center hooks need Node.js, but no node executable was found on PATH. Install Node.js or set "focusCenter.hooks.nodePath" to an absolute path, then try again.',
      );
      return;
    }
    const detail = [
      `File: ${settingsPath}`,
      `Adds one async command hook for: ${HOOK_EVENTS.join(', ')}.`,
      `Runs: ${nodePath} ${installedScriptPath(storageDir)} <event> ${spoolDirFor(storageDir)}`,
      'The hook records minimal event metadata locally, never blocks Claude and never approves or denies permissions.',
      `Existing settings and hooks are kept. A backup is saved in ${path.join(storageDir, 'backups')}.`,
      'Disable at any time with "Focus Center: Disable Claude Hooks".',
    ].join('\n\n');
    const choice = await vscode.window.showWarningMessage('Enable Claude Code hooks for Focus Center?', { modal: true, detail }, 'Enable Hooks');
    if (choice !== 'Enable Hooks') {
      return;
    }
    try {
      const result = await enableHooks({ settingsPath, storageDir, nodePath, hookSourceDir, scope: currentScope() });
      onChanged();
      void vscode.window.showInformationMessage(
        result.changed
          ? `Focus Center hooks enabled for ${result.events.length} events.${result.backupPath ? ` Backup: ${result.backupPath}` : ''}`
          : 'Focus Center hooks were already enabled; settings unchanged.',
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not enable hooks: ${message(err)}`);
    }
  };

  const disable = async (): Promise<void> => {
    const settingsPath = defaultSettingsPath();
    const choice = await vscode.window.showWarningMessage(
      'Disable Focus Center hooks?',
      { modal: true, detail: `Removes only Focus Center's hook entries from ${settingsPath}. Other settings and hooks are not changed. A backup is saved first.` },
      'Disable Hooks',
    );
    if (choice !== 'Disable Hooks') {
      return;
    }
    try {
      const result = await disableHooks({ settingsPath, storageDir });
      onChanged();
      void vscode.window.showInformationMessage(
        result.removed ? `Removed ${result.removed} Focus Center hook entries.${result.backupPath ? ` Backup: ${result.backupPath}` : ''}` : 'No Focus Center hooks were installed.',
      );
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not disable hooks: ${message(err)}`);
    }
  };

  return [
    vscode.commands.registerCommand('focusCenter.enableHooks', enable),
    vscode.commands.registerCommand('focusCenter.disableHooks', disable),
  ];
}

async function resolveNode(): Promise<string | undefined> {
  const configured = vscode.workspace.getConfiguration('focusCenter').get<unknown>('hooks.nodePath');
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.isAbsolute(configured.trim()) ? configured.trim() : undefined;
  }
  return findNodeOnPath();
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
