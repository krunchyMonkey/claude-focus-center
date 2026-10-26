import * as vscode from 'vscode';
import { buildRecap, markCaughtUp } from '../domain/recap/recap';
import type { StateService } from '../storage/stateService';
import { DetailsProvider, recapUri } from './sessionCommands';

export function registerRecapCommands(service: StateService, details: DetailsProvider, onChanged: () => void): vscode.Disposable[] {
  const mark = (): { checkpointSeq: number } => {
    // Only up to what the user has seen; newer changes stay for the next recap.
    const toSeq = details.lastRecapToSeq ?? buildRecap(service.state, new Date()).toSeq;
    service.update((state) => markCaughtUp(state, new Date(), toSeq));
    details.lastRecapToSeq = undefined;
    onChanged();
    return { checkpointSeq: service.state.checkpointSeq };
  };

  const catchMeUp = async (): Promise<{ empty: boolean; fromSeq: number; toSeq: number }> => {
    const recap = buildRecap(service.state, new Date());
    const doc = await vscode.workspace.openTextDocument(recapUri(recap.fromSeq, recap.toSeq));
    await vscode.languages.setTextDocumentLanguage(doc, 'markdown');
    await vscode.window.showTextDocument(doc, { preview: true });
    if (!recap.empty) {
      void vscode.window.showInformationMessage(
        `${recap.needsYou.length} need you, ${recap.resolved.length} resolved, ${recap.other.length} other change(s) since your last check.`,
        'Mark Caught Up',
      ).then((choice) => {
        if (choice === 'Mark Caught Up') {
          mark();
        }
      });
    }
    return { empty: recap.empty, fromSeq: recap.fromSeq, toSeq: recap.toSeq };
  };

  return [
    vscode.commands.registerCommand('focusCenter.catchMeUp', catchMeUp),
    vscode.commands.registerCommand('focusCenter.markCaughtUp', mark),
  ];
}
