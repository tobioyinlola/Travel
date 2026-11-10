export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export interface Scored<T> {
  doc: T;
  score: number;
}

/** Top-k by similarity above a floor; ties broken by id so results are stable. */
export function topK<T extends { id: string }>(
  query: ArrayLike<number>,
  docs: Array<T & { embedding: ArrayLike<number> }>,
  k: number,
  minScore: number,
  boost: (d: T) => number = () => 0,
): Array<Scored<T>> {
  return docs
    .map((d) => ({ doc: d as T, score: cosine(query, d.embedding) + boost(d) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
    .slice(0, k);
}

export type Confidence = 'high' | 'medium' | 'low';

/** FR-AI-06: how much the answer is backed by what was retrieved. */
export function confidenceFor(scores: number[]): Confidence {
  const best = scores[0] ?? 0;
  if (best >= 0.5 && scores.length >= 2) return 'high';
  if (best >= 0.3) return 'medium';
  return 'low';
}
