import { describe, expect, it } from 'vitest';
import { safeFilename, sniffType } from './file-type.js';

describe('attachment file types', () => {
  it('recognises PDF, PNG and JPEG by content', () => {
    expect(sniffType(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
    expect(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });
  it('refuses everything else, whatever it claims to be', () => {
    expect(sniffType(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffType(Buffer.from('MZ\x90\x00'))).toBeNull();
    expect(sniffType(Buffer.alloc(0))).toBeNull();
  });
  it('cleans file names', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('C:\\x\\passport "scan".pdf')).toBe('passport scan.pdf');
    expect(safeFilename('  \u0000 ')).toBe('file');
  });
});
