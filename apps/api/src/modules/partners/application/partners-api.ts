import { Injectable } from '@nestjs/common';
import { PartnersService, type ProgramInput } from './partners.service.js';

/** Public interface for higher layers (Admin now; Booking attaches perks in Sprint 4-6, FR-PRT-02). */
@Injectable()
export class PartnersApi {
  constructor(private readonly partners: PartnersService) {}

  listSuppliers() {
    return this.partners.listSuppliers();
  }
  createSupplier(actorId: string, input: Parameters<PartnersService['createSupplier']>[1]) {
    return this.partners.createSupplier(actorId, input);
  }
  listPrograms() {
    return this.partners.listPrograms();
  }
  createProgram(actorId: string, input: ProgramInput) {
    return this.partners.createProgram(actorId, input);
  }
  updateProgram(
    actorId: string,
    id: string,
    version: number,
    patch: Partial<Omit<ProgramInput, 'supplierId'>>,
  ) {
    return this.partners.updateProgram(actorId, id, version, patch);
  }
}
