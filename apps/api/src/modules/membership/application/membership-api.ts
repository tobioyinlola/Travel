import { Injectable } from '@nestjs/common';
import { MembershipService, type MembershipView } from './membership.service.js';

/** Public interface for higher layers (Admin, Commission, Reporting). */
@Injectable()
export class MembershipApi {
  constructor(private readonly membership: MembershipService) {}

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
