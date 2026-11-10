import { Global, Module } from '@nestjs/common';
import { CoursesService } from './application/courses.service.js';
import { LearningApi } from './application/learning-api.js';
import { ForumService } from './application/forum.service.js';
import { CommunityController } from './http/community.controller.js';
import { LearningController } from './http/learning.controller.js';

/**
 * Learning module (core domain layer). Courses, quizzes, the Essentials gate, community forum
 * (FR-LRN, FR-CMT). Owns schema: learning. May call: shared-kernel, identity.
 */
@Global() // exports only the public API
@Module({
  controllers: [LearningController, CommunityController],
  providers: [CoursesService, ForumService, LearningApi],
  exports: [LearningApi],
})
export class LearningModule {}
