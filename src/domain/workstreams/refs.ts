// Exact, namespaced work-item references. No fuzzy matching: a reference either has an explicit
// shape (AB#123, PROJ-123, #123) or it does not count.

export interface WorkItemRef {
  /** Namespaced key, e.g. `ado:123`, `jira:PROJ-123`, `github:<repo root>#123`. */
  key: string;
  /** As written, for display. */
  label: string;
}

const ADO = /\bAB#(\d{1,9})\b/g;
const JIRA = /\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g;
const HASH_NUMBER = /(?:^|[\s(])#(\d{1,7})\b/g;
// Branch segments like `123-fix-header`, `fix/123-header`, `issue-123`.
const BRANCH_NUMBER = /(?:^|\/)(?:issue[-_])?(\d{1,7})(?:[-_]|$)/i;

/** Refs from a git branch name. `repoKey` scopes bare numbers (GitHub-style issues) to one repo. */
export function refsFromBranch(branch: string, repoKey: string | undefined): WorkItemRef[] {
  const refs = [...matchAll(branch, ADO, (n) => ({ key: `ado:${n}`, label: `AB#${n}` })), ...matchAll(branch, JIRA, (k) => ({ key: `jira:${k}`, label: k })).filter((r) => isTicketKey(r.label))];
  const m = BRANCH_NUMBER.exec(branch);
  if (m && repoKey && refs.length === 0) {
    refs.push({ key: `github:${repoKey}#${m[1]}`, label: `#${m[1]}` });
  }
  return dedupe(refs);
}

/** Refs explicitly written in short metadata such as a task subject. */
export function refsFromText(text: string, repoKey: string | undefined): WorkItemRef[] {
  const refs = [...matchAll(text, ADO, (n) => ({ key: `ado:${n}`, label: `AB#${n}` })), ...matchAll(text, JIRA, (k) => ({ key: `jira:${k}`, label: k })).filter((r) => isTicketKey(r.label))];
  // Strip ADO refs first so "AB#12" is not also read as "#12".
  if (repoKey) {
    refs.push(...matchAll(text.replace(ADO, ''), HASH_NUMBER, (n) => ({ key: `github:${repoKey}#${n}`, label: `#${n}` })));
  }
  return dedupe(refs);
}

// Uppercase-dash-number tokens that are standards or versions, not ticket keys.
const NOT_TICKETS = new Set(['UTF', 'ISO', 'SHA', 'RFC', 'HTTP', 'TLS', 'SSL', 'AES', 'MD', 'CVE', 'CWE', 'GPT', 'ES', 'ECMA', 'IPV', 'IEEE', 'ANSI', 'PEP', 'JSR', 'X', 'V', 'H', 'TS', 'WCAG', 'OWASP', 'RSA', 'P', 'K']);

function isTicketKey(key: string): boolean {
  return !NOT_TICKETS.has(key.slice(0, key.lastIndexOf('-')));
}

function matchAll(text: string, re: RegExp, make: (m: string) => WorkItemRef): WorkItemRef[] {
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => make(m[1]));
}

function dedupe(refs: WorkItemRef[]): WorkItemRef[] {
  const seen = new Set<string>();
  return refs.filter((r) => !seen.has(r.key) && seen.add(r.key));
}
