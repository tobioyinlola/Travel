import { describe, expect, it } from 'vitest';
import { IllegalTransitionError } from '../../shared-kernel/index.js';
import { advisorLifecycle } from './advisor-status.js';

describe('advisor lifecycle (FR-AUTH-06, AC-01)', () => {
  it('follows the onboarding path to Active', () => {
    let s = advisorLifecycle.next('applied', 'checks_completed');
    expect(s).toBe('under_review');
    s = advisorLifecycle.next(s, 'membership_paid');
    expect(s).toBe('approved');
    expect(advisorLifecycle.next(s, 'essentials_passed')).toBe('active');
  });

  it('cannot become Active without passing Essentials', () => {
    expect(() => advisorLifecycle.next('under_review', 'essentials_passed')).toThrow(
      IllegalTransitionError,
    );
  });

  it('cannot be approved before checks are complete', () => {
    expect(advisorLifecycle.can('applied', 'membership_paid')).toBe(false);
  });

  it('treats rejected and offboarded as terminal', () => {
    for (const e of ['checks_completed', 'membership_paid', 'reinstated', 'offboarded'] as const) {
      expect(advisorLifecycle.can('rejected', e)).toBe(false);
      expect(advisorLifecycle.can('offboarded', e)).toBe(false);
    }
  });
});
