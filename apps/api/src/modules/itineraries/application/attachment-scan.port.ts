/** Virus / malware scan for uploaded files. A real scanner (decision pending) implements the same port. */
export const ATTACHMENT_SCANNER = Symbol('AttachmentScannerPort');

export interface AttachmentScannerPort {
  readonly name: string;
  scan(bytes: Buffer): Promise<{ clean: boolean; reason?: string }>;
}

/** Development stand-in: flags the standard EICAR test string, passes everything else. */
export class FakeAttachmentScanner implements AttachmentScannerPort {
  readonly name = 'fake-scanner';
  async scan(bytes: Buffer) {
    return bytes.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')
      ? { clean: false, reason: 'test signature' }
      : { clean: true };
  }
}
