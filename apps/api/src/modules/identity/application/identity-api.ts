import { Injectable } from '@nestjs/common';
import type { AdvisorStatus } from '../domain/advisor-status.js';
import {
  AdvisorsService,
  type AdvisorApplicationView,
  type AdvisorSummary,
  type ReviewDecision,
} from './advisors.service.js';
import type { Page } from '../../../platform/http/pagination.js';

/**
 * The identity module's public interface for modules in higher layers (Membership, Learning, Booking,
 * Admin). Plain data in and out; nothing here exposes tables or entities.
 */
@Injectable()
export class IdentityApi {
  constructor(private readonly advisors: AdvisorsService) {}

  getAdvisor(advisorId: string): Promise<AdvisorSummary | null> {
    return this.advisors.getAdvisor(advisorId);
  }

  getAdvisorByUser(userId: string): Promise<AdvisorSummary | null> {
    return this.advisors.getAdvisorByUser(userId);
  }

  getApplication(advisorId: string): Promise<AdvisorApplicationView> {
    return this.advisors.getApplication(advisorId);
  }

  listApplications(filter: {
    status?: AdvisorStatus | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<
    Page<AdvisorSummary & { submittedAt: string; kycStatus: string; agreementStatus: string }>
  > {
    return this.advisors.listApplications(filter);
  }

  decideApplication(
    advisorId: string,
    decision: ReviewDecision,
    note: string | null,
    actorId: string,
  ): Promise<AdvisorApplicationView> {
    return this.advisors.decide(advisorId, decision, note, actorId);
  }

  approveAfterMembershipPaid(advisorId: string): Promise<void> {
    return this.advisors.approveAfterMembershipPaid(advisorId);
  }

  recordEssentialsPassed(advisorId: string): Promise<void> {
    return this.advisors.recordEssentialsPassed(advisorId);
  }

  requireAdvisor(userId: string, allowed: readonly AdvisorStatus[]): Promise<AdvisorSummary> {
    return this.advisors.requireAdvisor(userId, allowed);
  }

  getDisplayName(userId: string): Promise<string> {
    return this.advisors.getDisplayName(userId);
  }

  canBook(advisorId: string): Promise<{ allowed: boolean; reason: string | null }> {
    return this.advisors.canBook(advisorId);
  }
}
