/**
 * Supplier and partner text is untrusted: a hotel description could say "ignore your instructions and ...".
 * Before indexing we neutralise instruction-like lines and count them; at prompt time sources are still wrapped
 * as quoted data (see the model adapter), so this is a second layer, not the only one.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier)/i,
  /(you are|act as|pretend to be) (now )?(a |an )?(different|new|unrestricted)/i,
  /^\s*(system|assistant|developer)\s*:/i,
  /<\/?(system|assistant|tool|instructions?)>/i,
  /reveal (your|the) (system )?(prompt|instructions)/i,
  /(send|email|forward) .{0,40}(to|at) \S+@\S+/i,
  /do not (tell|mention|inform) the (user|advisor)/i,
];

// eslint-disable-next-line no-control-regex -- removing control characters is the point
const HIDDEN_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u2060\ufeff]/g;

export interface Sanitized {
  text: string;
  /** How many lines were removed; documents with any are reported to admins. */
  flagged: number;
}

export function sanitizeUntrusted(input: string): Sanitized {
  let flagged = 0;
  // Judge each sentence on its own: a real description often puts an injected instruction on the same line.
  const kept = input
    .split(/\r?\n/)
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          if (INJECTION_PATTERNS.some((p) => p.test(sentence))) {
            flagged += 1;
            return false;
          }
          return true;
        })
        .join(' '),
    )
    .filter((l) => l.trim().length > 0);
  // Strip control characters and zero-width characters often used to hide instructions.
  const text = kept.join('\n').replace(HIDDEN_CHARS, '').trim();
  return { text, flagged };
}
