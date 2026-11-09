import { Module } from '@nestjs/common';
import { CoursesService } from './application/courses.service.js';
import { ForumService } from './application/forum.service.js';
import { CommunityController } from './http/community.controller.js';
import { LearningController } from './http/learning.controller.js';

/**
 * Learning module (core domain layer). Courses, quizzes, the Essentials gate, community forum
 * (FR-LRN, FR-CMT). Owns schema: learning. May call: shared-kernel, identity.
 */
@Module({
  controllers: [LearningController, CommunityController],
  providers: [CoursesService, ForumService],
})
export class LearningModule {}
