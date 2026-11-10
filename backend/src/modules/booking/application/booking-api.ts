import { Injectable } from '@nestjs/common';
import { BookingService } from './booking.service.js';

/** Public interface for higher layers (Admin: offboarding an advisor moves their open bookings). */
@Injectable()
export class BookingApi {
  constructor(private readonly booking: BookingService) {}

  openCount(advisorId: string) {
    return this.booking.openCount(advisorId);
  }

  reassignOpen(from: string, to: { advisorId: string; userId: string }, actorId: string) {
    return this.booking.reassignOpen(from, to, actorId);
  }
}
