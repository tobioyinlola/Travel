import { Injectable } from '@nestjs/common';
import { MembershipService, type MembershipView } from './membership.service.js';
import { TiersService } from './tiers.service.js';

/** Public interface for higher layers (Admin, Commission, Reporting). */
@Injectable()
export class MembershipApi {
  constructor(
    private readonly membership: MembershipService,
    private readonly tiers: TiersService,
  ) {}

  /** The advisor's commission split for a sale recognised now (FR-COM-02). */
  splitFor(advisorId: string, currency: string) {
    return this.tiers.splitFor(advisorId, currency);
  }

  tierProgress(advisorId: string) {
    return this.tiers.progress(advisorId);
  }

  getForAdvisor(advisorId: string): Promise<MembershipView | null> {
    return this.membership.getForAdvisor(advisorId);
  }

  createPromoCode(
    input: Parameters<MembershipService['createPromoCode']>[0],
    actorId: string,
  ): Promise<{ code: string }> {
    return this.membership.createPromoCode(input, actorId);
  }
}
