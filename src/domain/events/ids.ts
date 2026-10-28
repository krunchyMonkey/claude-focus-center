/** Event ids are `<source>:<sessionId>:<id>`. Over-matching only causes a harmless re-ingest. */
export function belongsToSession(eventId: string, sessionIds: ReadonlySet<string>): boolean {
  const first = eventId.indexOf(':');
  if (first < 0) {
    return false;
  }
  const rest = eventId.slice(first + 1);
  for (const sid of sessionIds) {
    if (rest.startsWith(`${sid}:`)) {
      return true;
    }
  }
  return false;
}
