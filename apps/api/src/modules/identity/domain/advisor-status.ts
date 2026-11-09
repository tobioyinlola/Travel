import { StateMachine } from '../../shared-kernel/index.js';

/**
 * Advisor lifecycle (FR-AUTH-06). `rejected` is an addition to the FRD list: ADM-01 lets admins reject an
 * application, and none of the FRD statuses describe that outcome.
 */
export const ADVISOR_STATUSES = [
  'applied',
  'under_review',
  'approved',
  'active',
  'suspended',
  'offboarded',
  'rejected',
] as const;
export type AdvisorStatus = (typeof ADVISOR_STATUSES)[number];

export type AdvisorEvent =
  | 'checks_completed' // KYC passed and agreement signed
  | 'information_requested'
  | 'rejected'
  | 'membership_paid' // accepted by admin and first membership payment succeeded (AC-01)
  | 'essentials_passed'
  | 'suspended'
  | 'reinstated'
  | 'offboarded';

export const advisorLifecycle = new StateMachine<AdvisorStatus, AdvisorEvent>('advisor', [
  { from: ['applied'], event: 'checks_completed', to: 'under_review' },
  { from: ['under_review'], event: 'information_requested', to: 'applied' },
  { from: ['applied', 'under_review'], event: 'rejected', to: 'rejected' },
  { from: ['under_review'], event: 'membership_paid', to: 'approved' },
  { from: ['approved'], event: 'essentials_passed', to: 'active' },
  { from: ['approved', 'active'], event: 'suspended', to: 'suspended' },
  { from: ['suspended'], event: 'reinstated', to: 'active' },
  {
    from: ['applied', 'under_review', 'approved', 'active', 'suspended'],
    event: 'offboarded',
    to: 'offboarded',
  },
]);
