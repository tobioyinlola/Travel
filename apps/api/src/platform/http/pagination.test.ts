import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, pageQuerySchema, toPage } from './pagination.js';

describe('cursor pagination', () => {
  it('round-trips a cursor and ignores garbage', () => {
    const key = { sort: '2026-11-09T10:00:00Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });

  it('trims the extra row and emits the next cursor', () => {
    const rows = [1, 2, 3].map((n) => ({ id: String(n), at: String(n) }));
    const page = toPage(rows, 2, (r) => ({ sort: r.at, id: r.id }));
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)).toEqual({ sort: '2', id: '2' });
    expect(toPage(rows.slice(0, 2), 2, (r) => ({ sort: r.at, id: r.id })).nextCursor).toBeNull();
  });

  it('bounds the page size', () => {
    expect(pageQuerySchema.parse({}).limit).toBe(25);
    expect(() => pageQuerySchema.parse({ limit: 500 })).toThrow();
  });
});
