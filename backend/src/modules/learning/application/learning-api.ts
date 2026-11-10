import { Injectable } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';

/** Public interface for higher layers (the AI assistant indexes approved course content). */
@Injectable()
export class LearningApi {
  constructor(private readonly db: Database) {}

  /** Published lessons, as plain text. Course content is reviewed before it ships, so it counts as approved. */
  async lessonsForIndex(): Promise<
    Array<{ id: string; course: string; title: string; body: string }>
  > {
    return this.db.read(
      'learning',
      `SELECT l.id, c.title AS course, l.title, l.body_md AS body
         FROM learning.lessons l JOIN learning.courses c ON c.id = l.course_id ORDER BY c.title, l.position`,
    );
  }
}
