import { describe, expect, it } from 'vitest';
import { eventCatalog, parseEventPayload } from './catalog.js';

describe('event catalog', () => {
  it('names every event in the past tense with a version', () => {
    for (const key of Object.keys(eventCatalog)) {
      expect(key).toMatch(/^[A-Z][A-Za-z]+(ed|Paid|Sent)\.v\d+$/);
    }
  });

  it('rejects a payload that does not match the contract', () => {
    expect(() => parseEventPayload('BookingConfirmed', 1, { bookingId: 'nope' })).toThrow();
  });

  it('accepts a valid payload', () => {
    const p = {
      bookingId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e5f',
      tripId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e60',
      advisorId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e61',
      supplierId: '0190f1c4-7a8b-7c3d-9e2f-0a1b2c3d4e62',
    };
    expect(parseEventPayload('BookingConfirmed', 1, p)).toEqual(p);
  });
});
