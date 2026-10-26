// Best-effort masking of obvious credentials before any excerpt is kept or displayed.
// This is a safety net, not a guarantee; excerpts are also kept short.

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, // generic "sk-..." API keys (Anthropic, OpenAI, Stripe-like)
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bA(?:KIA|SIA)[A-Z0-9]{16}\b/g, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/g, // credentials in URLs
];

// key=value / key: value where the key name suggests a secret.
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)[^\s"',;]{4,}\3/gi;

export const REDACTED = '[redacted]';

export function redact(text: string): string {
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match) => (/^(Bearer|Basic)\s/i.test(match) ? `${match.split(/\s+/)[0]} ${REDACTED}` : REDACTED));
  }
  return out.replace(SECRET_ASSIGNMENT, (_m, key: string, sep: string, quote: string) => `${key}${sep}${quote}${REDACTED}${quote}`);
}

/** Collapses whitespace, redacts, then keeps at most `max` characters from the start or end. */
export function boundedExcerpt(text: string, max: number, keep: 'start' | 'end' = 'start'): string {
  const clean = redact(text.replace(/\s+/g, ' ').trim());
  if (clean.length <= max) {
    return clean;
  }
  return keep === 'end' ? `…${clean.slice(clean.length - (max - 1))}` : `${clean.slice(0, max - 1)}…`;
}
