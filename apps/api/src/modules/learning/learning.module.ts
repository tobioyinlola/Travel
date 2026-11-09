import { Module } from '@nestjs/common';

/**
 * Learning module (core domain layer). Courses, quizzes, Essentials gate, forum (FR-LRN, FR-CMT).
 * Owns schema(s): learning.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit.
 */
@Module({
  providers: [],
  exports: [],
})
export class LearningModule {}
