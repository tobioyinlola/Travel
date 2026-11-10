import { z } from 'zod';

/** Cursor pagination (ARCH: "lists use cursor pagination"). Cursor = opaque base64url of the last sort key. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorKey {
  sort: string;
  id: string;
}

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify([key.sort, key.id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorKey | null {
  if (!cursor) return null;
  try {
    const [sort, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    if (typeof sort !== 'string' || typeof id !== 'string') return null;
    return { sort, id };
  } catch {
    return null;
  }
}

/** Fetch `limit + 1` rows, then call this to trim and compute the next cursor. */
export function toPage<T>(rows: T[], limit: number, keyOf: (row: T) => CursorKey): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(keyOf(last)) : null };
}
