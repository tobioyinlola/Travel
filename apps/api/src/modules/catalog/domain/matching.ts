/**
 * Property de-duplication across supplier feeds (FR-INV-02): shared identifier first, then location and name.
 */
const STOP_WORDS = new Set(['the', 'hotel', 'hotels', 'and', 'by', 'a']);

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .join(' ');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen-Dice similarity of character bigrams on normalised names, 0..1. */
export function nameSimilarity(a: string, b: string): number {
  const x = bigrams(normalizeName(a));
  const y = bigrams(normalizeName(b));
  let overlap = 0;
  let total = 0;
  for (const [g, n] of x) {
    overlap += Math.min(n, y.get(g) ?? 0);
    total += n;
  }
  for (const n of y.values()) total += n;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Great-circle distance in metres. */
export function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface Candidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sharedId: string | null;
}

export const MAX_MATCH_DISTANCE_M = 250;
export const MIN_NAME_SIMILARITY = 0.6;

/** Returns the existing property this content belongs to, or null to create a new one. */
export function findMatch(
  incoming: { name: string; lat: number; lng: number; sharedId: string | null },
  candidates: Candidate[],
): { id: string; reason: 'shared_id' | 'location_and_name' } | null {
  if (incoming.sharedId) {
    const same = candidates.find((c) => c.sharedId === incoming.sharedId);
    if (same) return { id: same.id, reason: 'shared_id' };
  }
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    if (distanceMetres(incoming.lat, incoming.lng, c.lat, c.lng) > MAX_MATCH_DISTANCE_M) continue;
    // Two different shared ids mean two different hotels, however close and similarly named.
    if (incoming.sharedId && c.sharedId && incoming.sharedId !== c.sharedId) continue;
    const score = nameSimilarity(incoming.name, c.name);
    if (score >= MIN_NAME_SIMILARITY && (!best || score > best.score)) best = { id: c.id, score };
  }
  return best ? { id: best.id, reason: 'location_and_name' } : null;
}
