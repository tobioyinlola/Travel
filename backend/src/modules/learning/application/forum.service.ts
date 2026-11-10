import { HttpStatus, Injectable } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { IdentityApi } from '../../identity/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import type { AuthUser } from '../../../platform/http/auth.js';
import { decodeCursor, toPage, type Page } from '../../../platform/http/pagination.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';

/** Distinct open reports that hide content automatically until a moderator looks at it. */
export const AUTO_HIDE_REPORTS = 3;
const POSTS_PER_10_MIN = 10;
const MODERATOR_ROLES = new Set(['support', 'admin']);

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

export interface ForumMember {
  userId: string;
  name: string;
  moderator: boolean;
}

export interface TopicSummary {
  id: string;
  category: string;
  title: string;
  authorName: string;
  replyCount: number;
  locked: boolean;
  hidden: boolean;
  lastActivityAt: string;
  createdAt: string;
}

export interface PostView {
  id: string;
  authorName: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
}

@Injectable()
export class ForumService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly audit: AuditWriter,
  ) {}

  /** Members are approved or active advisors; support and admin staff take part and moderate. */
  async member(user: AuthUser): Promise<ForumMember> {
    if (MODERATOR_ROLES.has(user.role)) {
      return {
        userId: user.id,
        name: await this.identity.getDisplayName(user.id),
        moderator: true,
      };
    }
    if (user.role !== 'advisor')
      throw problem(HttpStatus.FORBIDDEN, 'forbidden', 'The community is for advisors');
    await this.identity.requireAdvisor(user.id, ['approved', 'active']);
    return { userId: user.id, name: await this.identity.getDisplayName(user.id), moderator: false };
  }

  async categories() {
    return this.db.read<{ slug: string; name: string; description: string; topicCount: number }>(
      'learning',
      `SELECT c.slug, c.name, c.description,
              (SELECT count(*)::int FROM learning.forum_topics t WHERE t.category_id = c.id AND NOT t.hidden) AS "topicCount"
         FROM learning.forum_categories c ORDER BY c.position`,
    );
  }

  /** Newest activity first; `q` searches topics and their replies (Postgres full-text, English). */
  async listTopics(
    m: ForumMember,
    f: {
      category?: string | undefined;
      q?: string | undefined;
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<Page<TopicSummary>> {
    const params: unknown[] = [f.limit + 1];
    const where: string[] = [];
    if (!m.moderator) where.push('NOT t.hidden');
    if (f.category) {
      params.push(f.category);
      where.push(`c.slug = $${params.length}`);
    }
    if (f.q) {
      params.push(f.q);
      const q = `websearch_to_tsquery('english', $${params.length})`;
      where.push(`(t.search @@ ${q} OR EXISTS (SELECT 1 FROM learning.forum_posts p
                    WHERE p.topic_id = t.id AND NOT p.hidden AND p.search @@ ${q}))`);
    }
    const cursor = decodeCursor(f.cursor);
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(
        `(t.last_activity_at, t.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    const rows = await this.db.read<Record<string, unknown>>(
      'learning',
      `SELECT t.id, c.slug AS category, t.title, t.author_name, t.reply_count, t.locked, t.hidden, t.last_activity_at, t.created_at
         FROM learning.forum_topics t JOIN learning.forum_categories c ON c.id = t.category_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.last_activity_at DESC, t.id DESC LIMIT $1`,
      params,
    );
    return toPage(
      rows.map((r) => ({
        id: r.id as string,
        category: r.category as string,
        title: r.title as string,
        authorName: r.author_name as string,
        replyCount: r.reply_count as number,
        locked: r.locked as boolean,
        hidden: r.hidden as boolean,
        lastActivityAt: (r.last_activity_at as Date).toISOString(),
        createdAt: (r.created_at as Date).toISOString(),
      })),
      f.limit,
      (t) => ({ sort: t.lastActivityAt, id: t.id }),
    );
  }

  async getTopic(m: ForumMember, topicId: string) {
    const [t] = await this.db.read<Record<string, unknown>>(
      'learning',
      `SELECT t.*, c.slug AS category, c.name AS category_name FROM learning.forum_topics t
         JOIN learning.forum_categories c ON c.id = t.category_id WHERE t.id = $1`,
      [topicId],
    );
    if (!t || (t.hidden && !m.moderator))
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Topic not found');
    const posts = await this.db.read<Record<string, unknown>>(
      'learning',
      `SELECT * FROM learning.forum_posts WHERE topic_id = $1 ${m.moderator ? '' : 'AND NOT hidden'} ORDER BY created_at, id LIMIT 500`,
      [topicId],
    );
    const toPost = (p: Record<string, unknown>): PostView => ({
      id: p.id as string,
      authorName: p.author_name as string,
      body: p.body as string,
      hidden: p.hidden as boolean,
      createdAt: (p.created_at as Date).toISOString(),
      editedAt: p.edited_at ? (p.edited_at as Date).toISOString() : null,
      mine: p.author_user_id === m.userId,
    });
    return {
      id: t.id as string,
      category: t.category as string,
      categoryName: t.category_name as string,
      title: t.title as string,
      locked: t.locked as boolean,
      opening: toPost(t),
      replies: posts.map(toPost),
    };
  }

  private async rateLimit(tx: Tx, userId: string): Promise<void> {
    const [{ n }] = (await tx.query<{ n: number }>(
      `SELECT (SELECT count(*) FROM learning.forum_topics WHERE author_user_id = $1 AND created_at > now() - interval '10 minutes')
            + (SELECT count(*) FROM learning.forum_posts WHERE author_user_id = $1 AND created_at > now() - interval '10 minutes') AS n`,
      [userId],
    )) as [{ n: number }];
    if (Number(n) >= POSTS_PER_10_MIN) {
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate-limited',
        'You are posting very quickly',
        'Wait a few minutes and try again.',
      );
    }
  }

  async createTopic(
    m: ForumMember,
    input: { category: string; title: string; body: string },
  ): Promise<{ id: string }> {
    const id = newId();
    await this.db.transaction('learning', async (tx) => {
      await this.rateLimit(tx, m.userId);
      const [c] = await tx.query<{ id: string }>(
        'SELECT id FROM learning.forum_categories WHERE slug = $1',
        [input.category],
      );
      if (!c) throw problem(HttpStatus.BAD_REQUEST, 'category-invalid', 'Unknown category');
      await tx.query(
        `INSERT INTO learning.forum_topics (id, category_id, author_user_id, author_name, title, body) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, c.id, m.userId, m.name, input.title, input.body],
      );
    });
    return { id };
  }

  async reply(m: ForumMember, topicId: string, body: string): Promise<{ id: string }> {
    const id = newId();
    await this.db.transaction('learning', async (tx) => {
      await this.rateLimit(tx, m.userId);
      const [t] = await tx.query<{ locked: boolean; hidden: boolean }>(
        'SELECT locked, hidden FROM learning.forum_topics WHERE id = $1 FOR UPDATE',
        [topicId],
      );
      if (!t || (t.hidden && !m.moderator))
        throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Topic not found');
      if (t.locked && !m.moderator)
        throw problem(HttpStatus.CONFLICT, 'topic-locked', 'This topic is locked');
      await tx.query(
        `INSERT INTO learning.forum_posts (id, topic_id, author_user_id, author_name, body) VALUES ($1, $2, $3, $4, $5)`,
        [id, topicId, m.userId, m.name, body],
      );
      await tx.query(
        `UPDATE learning.forum_topics SET reply_count = reply_count + 1, last_activity_at = now() WHERE id = $1`,
        [topicId],
      );
    });
    return { id };
  }

  /** Authors edit their own words; nobody edits anyone else's. */
  async edit(m: ForumMember, type: 'topic' | 'post', id: string, body: string): Promise<void> {
    const table = type === 'topic' ? 'learning.forum_topics' : 'learning.forum_posts';
    const rows = await this.db.transaction('learning', (tx) =>
      tx.query(
        `UPDATE ${table} SET body = $3, edited_at = now() WHERE id = $1 AND author_user_id = $2 AND NOT hidden RETURNING id`,
        [id, m.userId, body],
      ),
    );
    if (rows.length === 0)
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Nothing of yours to edit here');
  }

  // ---------- Reports and moderation ----------

  async report(
    m: ForumMember,
    type: 'topic' | 'post',
    targetId: string,
    reason: string,
  ): Promise<{ hidden: boolean }> {
    const table = type === 'topic' ? 'learning.forum_topics' : 'learning.forum_posts';
    return this.db.transaction('learning', async (tx) => {
      const [target] = await tx.query<{ author_user_id: string; hidden: boolean }>(
        `SELECT author_user_id, hidden FROM ${table} WHERE id = $1 FOR UPDATE`,
        [targetId],
      );
      if (!target) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Not found');
      if (target.author_user_id === m.userId)
        throw problem(HttpStatus.BAD_REQUEST, 'own-content', 'You cannot report your own post');
      await tx.query(
        `INSERT INTO learning.forum_reports (id, target_type, target_id, reporter_user_id, reason) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (target_type, target_id, reporter_user_id) DO NOTHING`,
        [newId(), type, targetId, m.userId, reason],
      );
      const [{ n }] = (await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM learning.forum_reports WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
        [type, targetId],
      )) as [{ n: number }];
      if (n >= AUTO_HIDE_REPORTS && !target.hidden) {
        await tx.query(
          `UPDATE ${table} SET hidden = true, hidden_reason = 'Hidden automatically after reports' WHERE id = $1`,
          [targetId],
        );
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'community.auto_hidden',
          entityType: `forum_${type}`,
          entityId: targetId,
          module: 'learning',
          metadata: { openReports: n },
        });
        return { hidden: true };
      }
      return { hidden: target.hidden };
    });
  }

  async openReports() {
    const rows = await this.db.read<Record<string, unknown>>(
      'learning',
      `SELECT r.target_type, r.target_id, count(*)::int AS reports, array_agg(r.reason ORDER BY r.created_at) AS reasons,
              min(r.created_at) AS first_reported_at,
              coalesce(t.title, pt.title) AS topic_title, coalesce(t.id, p.topic_id) AS topic_id,
              coalesce(t.body, p.body) AS body, coalesce(t.author_name, p.author_name) AS author_name,
              coalesce(t.hidden, p.hidden) AS hidden
         FROM learning.forum_reports r
         LEFT JOIN learning.forum_topics t ON r.target_type = 'topic' AND t.id = r.target_id
         LEFT JOIN learning.forum_posts p ON r.target_type = 'post' AND p.id = r.target_id
         LEFT JOIN learning.forum_topics pt ON pt.id = p.topic_id
        WHERE r.status = 'open'
        GROUP BY r.target_type, r.target_id, t.title, pt.title, t.id, p.topic_id, t.body, p.body, t.author_name, p.author_name, t.hidden, p.hidden
        ORDER BY first_reported_at`,
    );
    return rows.map((r) => ({
      targetType: r.target_type as 'topic' | 'post',
      targetId: r.target_id as string,
      topicId: r.topic_id as string,
      topicTitle: r.topic_title as string,
      authorName: r.author_name as string,
      body: r.body as string,
      hidden: r.hidden as boolean,
      reports: r.reports as number,
      reasons: r.reasons as string[],
      firstReportedAt: (r.first_reported_at as Date).toISOString(),
    }));
  }

  /** Resolve every open report on a target: `hide` removes it from view, `dismiss` restores it. */
  async moderate(
    m: ForumMember,
    type: 'topic' | 'post',
    targetId: string,
    action: 'hide' | 'dismiss' | 'unhide' | 'lock' | 'unlock',
  ): Promise<void> {
    if (!m.moderator) throw problem(HttpStatus.FORBIDDEN, 'forbidden', 'Moderators only');
    const table = type === 'topic' ? 'learning.forum_topics' : 'learning.forum_posts';
    await this.db.transaction('learning', async (tx) => {
      const [before] = await tx.query<{ hidden: boolean }>(
        `SELECT hidden FROM ${table} WHERE id = $1 FOR UPDATE`,
        [targetId],
      );
      if (!before) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Not found');
      if (action === 'lock' || action === 'unlock') {
        if (type !== 'topic')
          throw problem(HttpStatus.BAD_REQUEST, 'bad-action', 'Only topics can be locked');
        await tx.query('UPDATE learning.forum_topics SET locked = $2 WHERE id = $1', [
          targetId,
          action === 'lock',
        ]);
      } else {
        const hide = action === 'hide';
        await tx.query(`UPDATE ${table} SET hidden = $2, hidden_reason = $3 WHERE id = $1`, [
          targetId,
          hide,
          hide ? 'Hidden by a moderator' : null,
        ]);
        if (action !== 'unhide') {
          await tx.query(
            `UPDATE learning.forum_reports SET status = $3, resolved_by = $4, resolved_at = now()
              WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
            [type, targetId, hide ? 'actioned' : 'dismissed', m.userId],
          );
        }
      }
      await this.audit.record({
        actorType: 'user',
        actorId: m.userId,
        action: `community.${action}`,
        entityType: `forum_${type}`,
        entityId: targetId,
        module: 'learning',
        before,
      });
    });
  }
}
