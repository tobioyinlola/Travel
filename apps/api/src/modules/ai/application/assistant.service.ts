import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ClientsApi } from '../../clients/index.js';
import { newId } from '../../shared-kernel/index.js';
import { flagClaims, type Flag } from '../domain/claims.js';
import { confidenceFor, topK, type Confidence } from '../domain/retrieval.js';
import { IndexerService } from './indexer.service.js';
import { MODEL_PORT, type ModelPort } from './model.port.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

const TOP_K = 5;
const MIN_SCORE = 0.12;
const NOTHING =
  "I couldn't find anything in your sources about that. Try rephrasing, or check with the supplier.";

interface DocRow {
  id: string;
  source_type: string;
  source_ref: string;
  owner_advisor_id: string | null;
  title: string;
  body: string;
  embedding: number[];
}

interface Source {
  id: string;
  type: string;
  title: string;
  snippet: string;
  score: number;
  cited: boolean;
  index: number | null;
}

const snippet = (s: string) => (s.length > 200 ? `${s.slice(0, 197)}...` : s);

/**
 * The advisor's assistant (FR-AI-01..08). It answers from retrieved sources only, says how sure it is, flags prices,
 * policies and perks it cannot verify, and records every interaction. It never contacts a traveler: drafts stay with
 * the advisor until they approve them (AC-09), and approving does not send anything either.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly db: Database,
    private readonly indexer: IndexerService,
    private readonly clients: ClientsApi,
    private readonly audit: AuditWriter,
    @Inject(MODEL_PORT) private readonly model: ModelPort,
  ) {}

  private asAdvisor<T>(advisorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('ai', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      return fn(tx);
    });
  }

  // ---------- Settings (FR-AI-05: advisor-visible controls) ----------

  async getSettings(advisorId: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const [s] = await tx.query<{ enabled: boolean; use_client_notes: boolean }>(
        'SELECT enabled, use_client_notes FROM ai.settings WHERE advisor_id = $1',
        [advisorId],
      );
      return { enabled: s?.enabled ?? true, useClientNotes: s?.use_client_notes ?? true };
    });
  }

  async putSettings(advisorId: string, input: { enabled: boolean; useClientNotes: boolean }) {
    await this.asAdvisor(advisorId, (tx) =>
      tx.query(
        `INSERT INTO ai.settings (advisor_id, enabled, use_client_notes) VALUES ($1, $2, $3)
         ON CONFLICT (advisor_id) DO UPDATE SET enabled = EXCLUDED.enabled, use_client_notes = EXCLUDED.use_client_notes, updated_at = now()`,
        [advisorId, input.enabled, input.useClientNotes],
      ),
    );
    // Turning client notes off removes them from the index straight away, not at the next refresh.
    if (!input.useClientNotes) await this.indexer.removeClientDocs(advisorId);
    return this.getSettings(advisorId);
  }

  // ---------- Retrieval and generation ----------

  private async run(
    advisorId: string,
    task: 'answer' | 'draft',
    prompt: string,
    clientId: string | undefined,
    recipientFirstName: string | undefined,
  ) {
    const settings = await this.getSettings(advisorId);
    if (!settings.enabled)
      throw problem(
        HttpStatus.FORBIDDEN,
        'ai-disabled',
        'The assistant is turned off',
        'Turn it on in the assistant settings.',
      );
    if (settings.useClientNotes) await this.indexer.refreshClientDocs(advisorId);

    const started = Date.now();
    const qv = await this.indexer.embed(prompt);
    const docs = await this.asAdvisor(advisorId, (tx) =>
      tx.query<DocRow>(
        `SELECT id, source_type, source_ref, owner_advisor_id, title, body, embedding FROM ai.documents
          WHERE (owner_advisor_id IS NULL OR owner_advisor_id = $1) AND ($2 OR source_type <> 'client')`,
        [advisorId, settings.useClientNotes],
      ),
    );
    const hits = topK(qv, docs, TOP_K, MIN_SCORE, (d) =>
      clientId && d.source_type === 'client' && d.source_ref === clientId ? 0.25 : 0,
    );
    const toolCalls = [
      {
        name: 'retrieve',
        args: { query: prompt.slice(0, 200), k: TOP_K },
        resultCount: hits.length,
      },
    ];

    const gen = hits.length
      ? await this.model.generate({
          task,
          question: prompt,
          sources: hits.map((h) => ({
            id: h.doc.id,
            title: h.doc.title,
            type: h.doc.source_type,
            text: h.doc.body,
          })),
          ...(recipientFirstName ? { recipientFirstName } : {}),
        })
      : { text: '', citedSourceIds: [] };

    const cited = gen.citedSourceIds;
    const sources: Source[] = hits.map((h) => ({
      id: h.doc.id,
      type: h.doc.source_type,
      title: h.doc.title,
      snippet: snippet(h.doc.body),
      score: Math.round(h.score * 100) / 100,
      cited: cited.includes(h.doc.id),
      index: cited.includes(h.doc.id) ? cited.indexOf(h.doc.id) + 1 : null,
    }));

    // Sentences taken from an approved partner program count as verified perks.
    const partnerSentences = new Set<string>();
    for (const h of hits)
      if (h.doc.source_type === 'partner' && cited.includes(h.doc.id))
        for (const s of h.doc.body.split(/(?<=[.!?])\s+/)) partnerSentences.add(s.trim());
    const plain = (t: string) => t.replace(/\s*\[\d+\]/g, '');
    const text = gen.text || (task === 'answer' ? NOTHING : '');
    const flags: Flag[] = gen.text
      ? flagClaims(plain(gen.text), new Set([...partnerSentences].map(plain)))
      : [];
    let confidence: Confidence = gen.text ? confidenceFor(hits.map((h) => h.score)) : 'low';
    if (flags.length > 0 && confidence === 'high') confidence = 'medium'; // unverified claims cap confidence

    return { text, sources, flags, confidence, toolCalls, hits, latencyMs: Date.now() - started };
  }

  private async log(
    tx: Tx,
    advisorId: string,
    kind: 'ask' | 'draft',
    prompt: string,
    r: Awaited<ReturnType<AssistantService['run']>>,
  ): Promise<string> {
    const id = newId();
    await tx.query(
      `INSERT INTO ai.interactions (id, advisor_id, kind, prompt, retrieved, tool_calls, output, confidence, flags, model, latency_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        id,
        advisorId,
        kind,
        prompt,
        JSON.stringify(
          r.sources.map((s) => ({ id: s.id, title: s.title, type: s.type, score: s.score })),
        ),
        JSON.stringify(r.toolCalls),
        r.text,
        r.confidence,
        JSON.stringify(r.flags),
        this.model.name,
        r.latencyMs,
      ],
    );
    return id;
  }

  async ask(advisorId: string, input: { question: string; clientId?: string | undefined }) {
    const r = await this.run(advisorId, 'answer', input.question, input.clientId, undefined);
    const id = await this.asAdvisor(advisorId, (tx) =>
      this.log(tx, advisorId, 'ask', input.question, r),
    );
    return { id, answer: r.text, confidence: r.confidence, sources: r.sources, flags: r.flags };
  }

  // ---------- Drafts (FR-AI-03, AC-09) ----------

  async createDraft(
    advisorId: string,
    input: {
      kind: 'client_message' | 'trip_summary';
      instruction: string;
      clientId?: string | undefined;
    },
  ) {
    let firstName: string | undefined;
    if (input.clientId) {
      const profile = (await this.clients.profilesForAi(advisorId)).find(
        (p) => p.id === input.clientId,
      );
      if (!profile) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Client not found');
      firstName = profile.name.split(' ')[0];
    }
    const r = await this.run(advisorId, 'draft', input.instruction, input.clientId, firstName);
    if (!r.text)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'nothing-to-draft',
        'There is not enough in your sources to draft that',
        'Add detail to the request, or write this one yourself.',
      );
    return this.asAdvisor(advisorId, async (tx) => {
      const interactionId = await this.log(tx, advisorId, 'draft', input.instruction, r);
      const id = newId();
      await tx.query(
        `INSERT INTO ai.drafts (id, advisor_id, interaction_id, kind, client_id, instruction, original_text, text, sources, flags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9)`,
        [
          id,
          advisorId,
          interactionId,
          input.kind,
          input.clientId ?? null,
          input.instruction,
          r.text,
          JSON.stringify(r.sources),
          JSON.stringify(r.flags),
        ],
      );
      return this.draftView(tx, advisorId, id);
    });
  }

  private async draftView(tx: Tx, advisorId: string, id: string) {
    const [d] = await tx.query<{
      id: string;
      kind: string;
      client_id: string | null;
      instruction: string;
      original_text: string;
      text: string;
      status: string;
      sources: Source[];
      flags: Flag[];
      created_at: Date;
      decided_at: Date | null;
    }>(`SELECT * FROM ai.drafts WHERE id = $1 AND advisor_id = $2`, [id, advisorId]);
    if (!d) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Draft not found');
    return {
      id: d.id,
      kind: d.kind,
      clientId: d.client_id,
      instruction: d.instruction,
      text: d.text,
      edited: d.text !== d.original_text,
      status: d.status,
      sources: d.sources,
      flags: d.flags,
      createdAt: d.created_at.toISOString(),
      decidedAt: d.decided_at?.toISOString() ?? null,
    };
  }

  async listDrafts(advisorId: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const ids = await tx.query<{ id: string }>(
        `SELECT id FROM ai.drafts WHERE advisor_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [advisorId],
      );
      const items = [];
      for (const { id } of ids) items.push(await this.draftView(tx, advisorId, id));
      return { items };
    });
  }

  /** The advisor decides. Approving records their final wording; it does not send anything to anyone. */
  async decide(advisorId: string, id: string, decision: 'approved' | 'rejected', text?: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const [d] = await tx.query<{ status: string; original_text: string }>(
        `SELECT status, original_text FROM ai.drafts WHERE id = $1 AND advisor_id = $2 FOR UPDATE`,
        [id, advisorId],
      );
      if (!d) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Draft not found');
      if (d.status !== 'draft')
        throw problem(HttpStatus.CONFLICT, 'draft-decided', `This draft is already ${d.status}`);
      const final = (text ?? d.original_text).trim();
      if (decision === 'approved' && final.length === 0)
        throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'draft-empty', 'The approved text is empty');
      await tx.query(
        `UPDATE ai.drafts SET status = $3, text = $4, decided_at = now() WHERE id = $1 AND advisor_id = $2`,
        [id, advisorId, decision, decision === 'approved' ? final : d.original_text],
      );
      await this.audit.record({
        actorType: 'user',
        action: `ai.draft_${decision}`,
        entityType: 'ai_draft',
        entityId: id,
        module: 'ai',
        metadata: { edited: decision === 'approved' && final !== d.original_text },
      });
      return this.draftView(tx, advisorId, id);
    });
  }

  // ---------- History (FR-AI-05) ----------

  async history(advisorId: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const rows = await tx.query<{
        id: string;
        kind: string;
        prompt: string;
        output: string;
        confidence: string;
        retrieved: Array<{ title: string }>;
        tool_calls: Array<{ name: string; resultCount: number }>;
        flags: unknown[];
        model: string;
        created_at: Date;
      }>(
        `SELECT id, kind, prompt, output, confidence, retrieved, tool_calls, flags, model, created_at
           FROM ai.interactions WHERE advisor_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [advisorId],
      );
      return {
        items: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          prompt: r.prompt,
          output: r.output,
          confidence: r.confidence,
          sources: r.retrieved.map((s) => s.title),
          toolCalls: r.tool_calls,
          flagCount: r.flags.length,
          model: r.model,
          createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  async deleteInteraction(advisorId: string, id: string) {
    const gone = await this.asAdvisor(advisorId, (tx) =>
      tx.query(`DELETE FROM ai.interactions WHERE id = $1 AND advisor_id = $2 RETURNING id`, [
        id,
        advisorId,
      ]),
    );
    if (gone.length === 0)
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Interaction not found');
  }
}
