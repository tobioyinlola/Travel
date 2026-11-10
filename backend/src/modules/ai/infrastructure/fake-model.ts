import { createHash } from 'node:crypto';
import type { ModelPort, SourceForModel } from '../application/model.port.js';

const DIMS = 256;
const STOP = new Set(
  'the and for with that this from have has are was were will would can could you your about what which when where who how not but any all our out into over than then them they their there here been being does did its too very just also more most some such only own same'.split(
    ' ',
  ),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** Hashed bag-of-words with simple stemming: deterministic, no network, good enough to test retrieval. */
function embedOne(text: string): number[] {
  const v = new Array<number>(DIMS).fill(0);
  for (const raw of tokens(text)) {
    const w = raw.replace(/(ing|ed|es|s)$/, '');
    const h = createHash('sha1').update(w).digest();
    v[h.readUInt16BE(0) % DIMS]! += h[2]! % 2 === 0 ? 1 : -1;
  }
  const norm = Math.sqrt(v.reduce((n, x) => n + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Stand-in model. Embeddings are hashed word vectors. "Generation" is extractive: it picks the sentences of the
 * sources that best match the question and quotes them with citations. It therefore cannot invent facts, which
 * keeps the grounding and flagging logic honest in tests. A hosted model replaces it in Sprint 10.
 */
export class FakeModel implements ModelPort {
  readonly name = 'fake-extractive-1';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedOne);
  }

  async generate(input: {
    task: 'answer' | 'draft';
    question: string;
    sources: SourceForModel[];
    recipientFirstName?: string;
  }): Promise<{ text: string; citedSourceIds: string[] }> {
    const q = new Set(tokens(input.question).map((w) => w.replace(/(ing|ed|es|s)$/, '')));
    const picked: Array<{ s: string; src: SourceForModel; n: number }> = [];
    for (const src of input.sources) {
      const best = sentences(src.text)
        .map((s) => ({
          s,
          n: tokens(s).filter((w) => q.has(w.replace(/(ing|ed|es|s)$/, ''))).length,
        }))
        .sort((a, b) => b.n - a.n)[0];
      if (best && best.n > 0) picked.push({ ...best, src });
    }
    picked.sort((a, b) => b.n - a.n);
    const top = picked.slice(0, 3);
    if (top.length === 0) return { text: '', citedSourceIds: [] };
    const cited = top.map((p) => p.src.id);
    const body = top.map((p, i) => `${p.s.replace(/\s+$/, '')} [${i + 1}]`);
    if (input.task === 'draft') {
      const hi = input.recipientFirstName ? `Hi ${input.recipientFirstName},` : 'Hello,';
      return {
        text: `${hi}\n\n${top.map((p) => p.s).join(' ')}\n\nLet me know if you would like me to look at options.`,
        citedSourceIds: cited,
      };
    }
    return { text: body.join(' '), citedSourceIds: cited };
  }
}
