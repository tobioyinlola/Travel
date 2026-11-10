export type FlagKind = 'price' | 'policy' | 'perk';

export interface Flag {
  sentence: string;
  kind: FlagKind;
  reason: string;
}

const MONEY =
  /([$€£]\s?\d[\d,.]*)|(\b\d[\d,.]*\s?(usd|eur|gbp|ngn|zar|dollars?|euros?|pounds?)\b)/i;
const POLICY =
  /\b(cancel\w*|refund\w*|non-refundable|deposit|penalt\w*|policy|check-?in time|check-?out time)\b/i;
const PERK =
  /\b(breakfast|upgrade|resort credit|late check-?out|early check-?in|welcome gift|perk\w*|complimentary)\b/i;

/**
 * FR-AI-06: prices, policies and perks are things a traveler will rely on, and the assistant's sources are not
 * live. Every sentence that makes such a claim is flagged "unverified" unless it is backed by an approved partner
 * program (for perks). Advisors verify against the live rate before telling a client.
 */
export function flagClaims(
  text: string,
  partnerBackedSentences: ReadonlySet<string> = new Set(),
): Flag[] {
  const flags: Flag[] = [];
  for (const raw of text.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (MONEY.test(sentence))
      flags.push({
        sentence,
        kind: 'price',
        reason: 'Prices change: check the live rate before quoting.',
      });
    if (POLICY.test(sentence))
      flags.push({
        sentence,
        kind: 'policy',
        reason: 'Policies vary by rate: confirm the terms on the rate.',
      });
    if (PERK.test(sentence) && !partnerBackedSentences.has(sentence))
      flags.push({ sentence, kind: 'perk', reason: 'Not confirmed by an active partner program.' });
  }
  return flags;
}
