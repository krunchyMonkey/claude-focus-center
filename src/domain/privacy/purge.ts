// Removes everything Focus Center stored about sessions that are now out of scope (excluded, or
// outside the allow-list), so changing the scope also forgets old data, not just future data.
import { inScope, MonitoringScope } from '../../hook/scope';
import type { FocusState } from '../state/types';
import { regroup } from '../workstreams/group';

export function purgeOutOfScope(state: FocusState, scope: MonitoringScope, platform: NodeJS.Platform = process.platform): string[] {
  const collecting = { ...scope, paused: false }; // pausing stops collection; it does not delete
  const removed = Object.values(state.sessions).filter((s) => !inScope(s.cwd, collecting, platform)).map((s) => s.sessionId);
  if (removed.length === 0) {
    return [];
  }
  const gone = new Set(removed);
  const goneItems = new Set<string>();
  for (const id of removed) {
    const transcript = state.sessions[id].transcriptPath;
    if (transcript) {
      delete state.cursors[transcript];
    }
    delete state.sessions[id];
    delete state.manualLinks[id];
  }
  for (const item of Object.values(state.items)) {
    if (item.sourceSessionIds.some((id) => gone.has(id))) {
      goneItems.add(item.id);
      delete state.items[item.id];
    }
  }
  // Journal summaries can carry titles/excerpts from those sessions.
  state.journal = state.journal.filter((j) => !(j.sessionId && gone.has(j.sessionId)) && !(j.itemId && goneItems.has(j.itemId)));
  regroup(state, platform);
  return removed;
}
