import { StateMachine } from '../../shared-kernel/index.js';

export type BookingStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'modified'
  | 'cancelled'
  | 'completed'
  | 'reversed';

export type BookingEvent =
  | 'start' // traveler committed: payment captured, or nothing to pay now
  | 'confirm' // every supplier confirmed
  | 'fail' // a supplier refused or stayed unreachable
  | 'modify' // dates or guests changed (Sprint 5)
  | 'reconfirm' // the modification was confirmed
  | 'cancel'
  | 'complete' // the stay is over
  | 'reverse'; // finance reversal (Sprint 6)

/** FRD booking state machine. Anything not listed is rejected. */
export const bookingMachine = new StateMachine<BookingStatus, BookingEvent>('booking', [
  { from: ['draft'], event: 'start', to: 'pending' },
  { from: ['pending'], event: 'confirm', to: 'confirmed' },
  { from: ['pending'], event: 'fail', to: 'failed' },
  { from: ['confirmed'], event: 'modify', to: 'modified' },
  { from: ['modified'], event: 'reconfirm', to: 'confirmed' },
  { from: ['confirmed', 'modified'], event: 'cancel', to: 'cancelled' },
  { from: ['confirmed', 'modified'], event: 'complete', to: 'completed' },
  { from: ['completed', 'cancelled'], event: 'reverse', to: 'reversed' },
]);

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'draft',
  'pending',
  'confirmed',
  'failed',
  'modified',
  'cancelled',
  'completed',
  'reversed',
];
