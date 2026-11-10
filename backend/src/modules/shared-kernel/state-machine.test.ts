import { describe, expect, it } from 'vitest';
import { IllegalTransitionError, StateMachine } from './state-machine.js';

type S = 'Draft' | 'Pending' | 'Confirmed' | 'Failed';
type E = 'submit' | 'confirm' | 'reject';

const m = new StateMachine<S, E>('booking', [
  { from: ['Draft'], event: 'submit', to: 'Pending' },
  { from: ['Pending'], event: 'confirm', to: 'Confirmed' },
  { from: ['Pending'], event: 'reject', to: 'Failed' },
]);

describe('StateMachine', () => {
  it('follows listed transitions', () => {
    expect(m.next('Draft', 'submit')).toBe('Pending');
    expect(m.next('Pending', 'confirm')).toBe('Confirmed');
  });
  it('rejects anything not listed', () => {
    expect(() => m.next('Draft', 'confirm')).toThrow(IllegalTransitionError);
    expect(m.can('Confirmed', 'reject')).toBe(false);
  });
});
