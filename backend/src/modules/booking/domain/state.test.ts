import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../shared-kernel/index.js';
import {
  BOOKING_STATUSES,
  bookingMachine,
  type BookingEvent,
  type BookingStatus,
} from './state.js';

const EVENTS: BookingEvent[] = [
  'start',
  'confirm',
  'fail',
  'modify',
  'reconfirm',
  'cancel',
  'complete',
  'reverse',
];

const ALLOWED: Array<[BookingStatus, BookingEvent, BookingStatus]> = [
  ['draft', 'start', 'pending'],
  ['pending', 'confirm', 'confirmed'],
  ['pending', 'fail', 'failed'],
  ['confirmed', 'modify', 'modified'],
  ['modified', 'reconfirm', 'confirmed'],
  ['confirmed', 'cancel', 'cancelled'],
  ['modified', 'cancel', 'cancelled'],
  ['confirmed', 'complete', 'completed'],
  ['modified', 'complete', 'completed'],
  ['completed', 'reverse', 'reversed'],
  ['cancelled', 'reverse', 'reversed'],
];

describe('booking state machine', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, event, to) => {
    expect(bookingMachine.next(from, event)).toBe(to);
  });

  it('rejects every transition that is not listed', () => {
    const allowed = new Set(ALLOWED.map(([f, e]) => `${f}:${e}`));
    for (const from of BOOKING_STATUSES) {
      for (const event of EVENTS) {
        if (allowed.has(`${from}:${event}`)) continue;
        expect(() => bookingMachine.next(from, event), `${from} ${event}`).toThrow(
          IllegalTransitionError,
        );
      }
    }
  });

  it('treats failed and reversed as terminal', () => {
    for (const event of EVENTS) {
      expect(bookingMachine.can('failed', event)).toBe(false);
      expect(bookingMachine.can('reversed', event)).toBe(false);
    }
  });
});
