import type { AttentionItem, AttentionStatus } from '../state/types';

/**
 * Status as the user should see it: user overrides on top of the rule-derived status, which is
 * kept unchanged underneath so it can be reopened and explained.
 */
export function effectiveStatus(item: AttentionItem, now: Date): AttentionStatus {
  if (item.manuallyResolvedAt) {
    return 'resolved';
  }
  if (item.snoozedUntil && item.snoozedUntil > now.toISOString()) {
    return 'waiting';
  }
  return item.status;
}

/** Newest evidence timestamp: when this item last changed at the source. */
export function lastEvidenceAt(item: AttentionItem): string | undefined {
  return item.evidence.reduce<string | undefined>((max, e) => (e.timestamp && (!max || e.timestamp > max) ? e.timestamp : max), undefined);
}
