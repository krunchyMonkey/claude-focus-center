import * as vscode from 'vscode';
import type { StateService } from '../storage/stateService';

/**
 * Only one VS Code window writes Focus Center's shared state. In any other window, actions that
 * change state are refused with an explanation instead of silently being lost.
 */
export function requireWriter(service: StateService, what: string): boolean {
  if (!service.readOnly) {
    return true;
  }
  void vscode.window.showWarningMessage(
    `Another VS Code window owns Focus Center's data, so you can't ${what} here. Do it in that window, or close it and this one takes over.`,
  );
  return false;
}
