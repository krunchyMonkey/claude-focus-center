// Removes everything Focus Center stored about sessions that are now out of scope (excluded, or
// outside the allow-list), so changing the scope also forgets old data, not just future data.
import { inScope, MonitoringScope } from '../../hook/scope';
import { belongsToSession } from '../events/ids';
import type { FocusState } from '../state/types';
import { regroup } from '../workstreams/group';

export interface PurgeResult {
  sessionIds: string[];
  transcriptPaths: string[];
}

export function purgeOutOfScope(state: FocusState, scope: MonitoringScope, platform: NodeJS.Platform = process.platform): PurgeResult {
  const collecting = { ...scope, paused: false }; // pausing stops collection; it does not delete
  const removed = Object.values(state.sessions).filter((s) => !inScope(s.cwd, collecting, platform));
  const sessionIds = removed.map((s) => s.sessionId);
  const transcriptPaths = removed.flatMap((s) => (s.transcriptPath ? [s.transcriptPath] : []));
  if (sessionIds.length === 0) {
    return { sessionIds, transcriptPaths };
  }
  const gone = new Set(sessionIds);
  const goneItems = new Set<string>();
  for (const id of sessionIds) {
    const transcript = state.sessions[id].transcriptPath;
    if (transcript) {
      delete state.cursors[transcript];
    }
    delete state.sessions[id];
    delete state.manualLinks[id];
  }
  // Forget the dedupe ids too, so the same events are applied again if the project is re-included.
  state.processedEventIds = state.processedEventIds.filter((id) => !belongsToSession(id, gone));
  for (const item of Object.values(state.items)) {
    if (item.sourceSessionIds.some((id) => gone.has(id))) {
      goneItems.add(item.id);
      delete state.items[item.id];
    }
  }
  // Journal summaries can carry titles/excerpts from those sessions.
  state.journal = state.journal.filter((j) => !(j.sessionId && gone.has(j.sessionId)) && !(j.itemId && goneItems.has(j.itemId)));
  regroup(state, platform);
  return { sessionIds, transcriptPaths };
}
