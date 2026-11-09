import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { CoursesService } from '../application/courses.service.js';
import {
  courseSchema,
  courseSummarySchema,
  lessonSchema,
  quizResultSchema,
  quizSchema,
  quizSubmitSchema,
} from './schemas.js';

/** Courses and the Essentials gate (FR-LRN-01, FR-LRN-02). */
@ApiTags('learning')
@Controller({ path: 'learning/courses', version: '1' })
@Roles('advisor')
export class LearningController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  @ZResponse(200, z.array(courseSummarySchema))
  async list(@CurrentUser() user: AuthUser) {
    const a = await this.courses.learner(user.id);
    return this.courses.listCourses(a.id);
  }

  @Get(':slug')
  @ZResponse(200, courseSchema)
  async get(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    const a = await this.courses.learner(user.id);
    return this.courses.getCourse(slug, a.id);
  }

  @Get(':slug/lessons/:position')
  @ZResponse(200, lessonSchema)
  async lesson(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('position', ParseIntPipe) position: number,
  ) {
    await this.courses.learner(user.id);
    return this.courses.getLesson(slug, position);
  }

  @Post(':slug/lessons/:position/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @Param('position', ParseIntPipe) position: number,
  ) {
    const a = await this.courses.learner(user.id);
    await this.courses.completeLesson(slug, position, a.id);
  }

  @Get(':slug/quiz')
  @ZResponse(200, quizSchema)
  async quiz(@CurrentUser() user: AuthUser, @Param('slug') slug: string) {
    const a = await this.courses.learner(user.id);
    return this.courses.getQuiz(slug, a.id);
  }

  @Post(':slug/quiz/attempts')
  @ZResponse(201, quizResultSchema)
  async submit(
    @CurrentUser() user: AuthUser,
    @Param('slug') slug: string,
    @ZBody(quizSubmitSchema) body: z.infer<typeof quizSubmitSchema>,
  ) {
    const a = await this.courses.learner(user.id);
    return this.courses.submitQuiz(slug, a, body.answers);
  }
}
