// Public interface of the identity module. Other modules may import ONLY from this file.
export { IdentityModule } from './identity.module.js';
export { IdentityApi } from './application/identity-api.js';
export type {
  AdvisorSummary,
  AdvisorApplicationView,
  ReviewDecision,
} from './application/advisors.service.js';
export type { AdvisorStatus } from './domain/advisor-status.js';
export { ADVISOR_STATUSES } from './domain/advisor-status.js';
export { AuthService } from './application/auth.service.js';
