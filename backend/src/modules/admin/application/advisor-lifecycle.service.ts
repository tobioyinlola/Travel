import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { BookingApi } from '../../booking/index.js';
import { IdentityApi, type AdvisorStatus } from '../../identity/index.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

/**
 * Suspend, reinstate and offboard advisors (FR-ADM-02). Offboarding with open bookings needs a successor: the
 * bookings (and their trips and clients) are reassigned first, then the advisor is offboarded. Both steps are safe to
 * repeat, so a failure between them is fixed by running the same request again.
 */
@Injectable()
export class AdvisorLifecycleService {
  constructor(
    private readonly identity: IdentityApi,
    private readonly bookings: BookingApi,
  ) {}

  list(filter: { status?: AdvisorStatus | undefined; q?: string | undefined }) {
    return this.identity.listAdvisors(filter);
  }

  async suspend(advisorId: string, reason: string) {
    return this.identity.changeAdvisorStatus(advisorId, 'suspended', reason);
  }

  async reinstate(advisorId: string, reason: string) {
    return this.identity.changeAdvisorStatus(advisorId, 'reinstated', reason);
  }

  async offboard(advisorId: string, reason: string, actorId: string, reassignToAdvisorId?: string) {
    const advisor = await this.identity.getAdvisor(advisorId);
    if (!advisor) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Advisor not found');
    if (advisor.status === 'offboarded')
      throw problem(
        HttpStatus.CONFLICT,
        'status-not-allowed',
        'This advisor is already offboarded',
      );

    const open = await this.bookings.openCount(advisorId);
    let reassigned = 0;
    if (open > 0) {
      if (!reassignToAdvisorId)
        throw problem(
          HttpStatus.CONFLICT,
          'open-bookings',
          `${open} open booking${open === 1 ? '' : 's'} need a new advisor`,
          'Name an active advisor to take them over (reassignToAdvisorId).',
        );
      if (reassignToAdvisorId === advisorId)
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'reassign-target-invalid',
          'Choose a different advisor',
        );
      const target = await this.identity.getAdvisor(reassignToAdvisorId);
      const gate = target ? await this.identity.canBook(reassignToAdvisorId) : { allowed: false };
      if (!target || !gate.allowed)
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'reassign-target-invalid',
          'The new advisor must be active',
        );
      const moved = await this.bookings.reassignOpen(
        advisorId,
        { advisorId: target.id, userId: target.userId },
        actorId,
      );
      reassigned = moved.bookingIds.length;
    }
    const after = await this.identity.changeAdvisorStatus(advisorId, 'offboarded', reason);
    return { advisor: after, reassignedBookings: reassigned };
  }
}
