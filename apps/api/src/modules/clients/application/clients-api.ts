import { Injectable } from '@nestjs/common';
import { ClientsService } from './clients.service.js';

/** Public interface for higher layers (Admin now; Itineraries and AI later). */
@Injectable()
export class ClientsApi {
  constructor(private readonly clients: ClientsService) {}

  getNames(advisorId: string, ids: string[]) {
    return this.clients.names(advisorId, ids);
  }

  countActive(advisorId: string) {
    return this.clients.count(advisorId);
  }

  getContact(advisorId: string, clientId: string) {
    return this.clients.contact(advisorId, clientId);
  }

  listPrivacyRequests(status?: string) {
    return this.clients.listPrivacyRequests(status);
  }

  verifyPrivacyRequest(staffId: string, requestId: string, note: string) {
    return this.clients.verifyPrivacyRequest(staffId, requestId, note);
  }

  rejectPrivacyRequest(staffId: string, requestId: string, reason: string) {
    return this.clients.rejectPrivacyRequest(staffId, requestId, reason);
  }

  privacyExport(requestId: string) {
    return this.clients.exportFor(requestId);
  }
}
