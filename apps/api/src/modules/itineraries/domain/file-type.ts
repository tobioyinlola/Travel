export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export type AttachmentType = 'application/pdf' | 'image/png' | 'image/jpeg';

/** The type comes from the file's own first bytes, never from what the uploader claims. */
export function sniffType(b: Buffer): AttachmentType | null {
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

/** A name safe to show and to put in a download header: no paths, no control characters. */
export function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const clean = [...base]
    .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127 && !'"<>:*?|'.includes(c))
    .join('')
    .trim()
    .slice(0, 200);
  return clean || 'file';
}
