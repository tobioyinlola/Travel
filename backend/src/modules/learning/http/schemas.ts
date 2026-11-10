import { z } from 'zod';

export const courseSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  isEssentials: z.boolean(),
  lessonCount: z.number(),
  lessonsCompleted: z.number(),
  passed: z.boolean(),
});
export const courseSchema = courseSummarySchema.extend({
  passMarkPct: z.number(),
  lessons: z.array(
    z.object({
      id: z.uuid(),
      position: z.number(),
      title: z.string(),
      estMinutes: z.number(),
      completed: z.boolean(),
    }),
  ),
  quiz: z.object({
    questionCount: z.number(),
    unlocked: z.boolean(),
    attemptsToday: z.number(),
    attemptsLeftToday: z.number(),
    bestScorePct: z.number().nullable(),
  }),
});
export const lessonSchema = z.object({
  id: z.uuid(),
  position: z.number(),
  title: z.string(),
  bodyMarkdown: z.string(),
  estMinutes: z.number(),
  lessonCount: z.number(),
});
export const quizSchema = z.object({
  passMarkPct: z.number(),
  attemptsLeftToday: z.number(),
  questions: z.array(
    z.object({
      id: z.uuid(),
      prompt: z.string(),
      options: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
});
export const quizSubmitSchema = z.object({ answers: z.record(z.uuid(), z.string().max(8)) });
export const quizResultSchema = z.object({
  scorePct: z.number(),
  passed: z.boolean(),
  passMarkPct: z.number(),
  incorrect: z.array(z.string()),
  review: z
    .array(z.object({ questionId: z.string(), correctOption: z.string(), explanation: z.string() }))
    .nullable(),
  bookingUnlocked: z.boolean(),
});

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const topicCreateSchema = z.object({
  category: z.string().min(1),
  title: text(5, 150),
  body: text(1, 10000),
});
export const replySchema = z.object({ body: text(1, 10000) });
export const editSchema = z.object({ body: text(1, 10000) });
export const reportSchema = z.object({
  targetType: z.enum(['topic', 'post']),
  targetId: z.uuid(),
  reason: z.enum(['spam', 'harassment', 'off_topic', 'misinformation', 'other']),
});
export const topicListQuery = z.object({
  category: z.string().optional(),
  q: z.string().trim().min(2).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export const topicSummarySchema = z.object({
  id: z.uuid(),
  category: z.string(),
  title: z.string(),
  authorName: z.string(),
  replyCount: z.number(),
  locked: z.boolean(),
  hidden: z.boolean(),
  lastActivityAt: z.string(),
  createdAt: z.string(),
});
const postSchema = z.object({
  id: z.uuid(),
  authorName: z.string(),
  body: z.string(),
  hidden: z.boolean(),
  createdAt: z.string(),
  editedAt: z.string().nullable(),
  mine: z.boolean(),
});
export const topicSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  categoryName: z.string(),
  title: z.string(),
  locked: z.boolean(),
  opening: postSchema,
  replies: z.array(postSchema),
});
export const moderationActionSchema = z.object({
  action: z.enum(['hide', 'dismiss', 'unhide', 'lock', 'unlock']),
});
export const reportQueueSchema = z.array(
  z.object({
    targetType: z.enum(['topic', 'post']),
    targetId: z.uuid(),
    topicId: z.uuid(),
    topicTitle: z.string(),
    authorName: z.string(),
    body: z.string(),
    hidden: z.boolean(),
    reports: z.number(),
    reasons: z.array(z.string()),
    firstReportedAt: z.string(),
  }),
);
