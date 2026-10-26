// Rules-first detection of explicit asks in the *closing* text of an assistant message.
// Deliberately narrow: a message only counts when it plainly asks the user to decide or review.
// Anything else is left alone (no item), never escalated.

export interface AskMatch {
  kind: 'decision' | 'review';
  /** The phrase that matched, for the evidence explanation. */
  cue: string;
  /** The sentence that carries the ask, bounded. */
  sentence: string;
}

const REVIEW_CUES: RegExp[] = [
  /\b(?:please|could you|can you|would you)\s+(?:review|take a look at|look over|check)\b[^.?!]*/i,
  /\bready for (?:your )?review\b/i,
  /\b(?:needs?|awaiting|waiting for) (?:your )?review\b/i,
];

const DECISION_QUESTION_CUES: RegExp[] = [
  /\b(?:should|shall) I\b/i,
  /\b(?:do|would) you (?:want|like|prefer)\b/i,
  /\bwant me to\b/i,
  /\bwhich (?:one|option|approach|version|path|of these)\b/i,
  /\b(?:ok|okay) (?:to|if I) (?:proceed|continue|go ahead)\b/i,
  /\bhow would you like\b/i,
  /\bcan you (?:confirm|clarify|decide)\b/i,
  /\b(?:proceed|go ahead)\s*\?/i,
];

const DECISION_STATEMENT_CUES: RegExp[] = [
  /\blet me know (?:if|whether|which|how|what)\b/i,
  /\b(?:waiting|wait) (?:for|on) your (?:input|decision|answer|confirmation|go-ahead)\b/i,
  /\bI need your (?:input|decision|confirmation|approval)\b/i,
  /\bplease (?:confirm|choose|decide|advise)\b/i,
];

const MAX_SENTENCE = 160;

/** Looks only at the last two sentences, where a closing ask lives. */
export function detectAsk(text: string): AskMatch | undefined {
  const sentences = splitSentences(text);
  const tail = sentences.slice(-2);
  for (const sentence of [...tail].reverse()) {
    for (const re of REVIEW_CUES) {
      const m = re.exec(sentence);
      if (m) {
        return { kind: 'review', cue: m[0].trim(), sentence: bound(sentence) };
      }
    }
    if (sentence.trim().endsWith('?')) {
      for (const re of DECISION_QUESTION_CUES) {
        const m = re.exec(sentence);
        if (m) {
          return { kind: 'decision', cue: m[0].trim(), sentence: bound(sentence) };
        }
      }
    }
    for (const re of DECISION_STATEMENT_CUES) {
      const m = re.exec(sentence);
      if (m) {
        return { kind: 'decision', cue: m[0].trim(), sentence: bound(sentence) };
      }
    }
  }
  return undefined;
}

function splitSentences(text: string): string[] {
  // Drop fenced code: questions inside code are not addressed to the user. Excerpts are message
  // tails, so an odd fence count means the excerpt starts inside a block: drop up to its end.
  let t = text;
  if ((t.match(/```/g) ?? []).length % 2 === 1) {
    t = t.slice(t.indexOf('```') + 3);
  }
  const clean = t.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, 'code').replace(/\s+/g, ' ').trim();
  return clean.split(/(?<=[.?!])\s+(?=[^a-z])/).map((s) => s.trim()).filter(Boolean);
}

function bound(sentence: string): string {
  const s = sentence.replace(/^…/, '').trim();
  return s.length <= MAX_SENTENCE ? s : `${s.slice(0, MAX_SENTENCE - 1)}…`;
}
