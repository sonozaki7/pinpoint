import { createHash } from 'node:crypto';
import type { EditResult } from '../../../../shared/contract.js';
import type { DraftConnector, NoteHit, NotesConnector } from '../connectors/types.js';
import { applyDraftEdits } from '../core/draft.js';
import { editSentence } from '../core/edit.js';
import type { AttentionSource, AttentionThread } from '../core/types.js';
import { gmailReceipt } from './receipts.js';
import type {
  ReviewSource,
  SourceDelivery,
  SourceDeliveryInput,
  SourceDetail,
  SourceEditInput,
} from './types.js';

export interface GmailDraftSourceOptions {
  drafts: DraftConnector;
  /** Notion search, used only as evidence for a flag such as "notes say net-45". */
  notes?: NotesConnector;
  /** GMAIL_DRAFTS_QUERY; default "label:pinpoint". */
  query?: string;
  max?: number;
}

const THREAD_PREFIX = 'gmail:';
const DEFAULT_QUERY = 'label:pinpoint';

function draftId(threadId: string): string {
  return threadId.startsWith(THREAD_PREFIX) ? threadId.slice(THREAD_PREFIX.length) : threadId;
}

function subjectQuery(subject: string, toName: string): string {
  const clean = subject.replace(/^(?:re|fwd|fw)\s*:\s*/gi, '').trim();
  const words = clean.split(/[^\p{L}\p{N}@.-]+/u).filter((word) => word.length > 2).slice(0, 4);
  return [...new Set([...words, toName].filter(Boolean))].join(' ');
}

/**
 * A Gmail draft an agent already wrote. One point per sentence, edited in
 * place; sending applies the stored edits to the draft and sends that draft.
 * Pinpoint never writes an email from a blank page.
 */
export class GmailDraftSource implements ReviewSource {
  readonly app = 'gmail' as const;
  private readonly drafts: DraftConnector;
  private readonly notes?: NotesConnector;
  private readonly query: string;
  private readonly max: number;

  constructor(options: GmailDraftSourceOptions) {
    this.drafts = options.drafts;
    this.notes = options.notes;
    this.query = options.query?.trim() || DEFAULT_QUERY;
    this.max = options.max ?? 10;
  }

  async listAttention(): Promise<AttentionThread[]> {
    const drafts = await this.drafts.listDrafts({ query: this.query, max: this.max });
    return drafts
      .filter((draft) => draft.id.length > 0)
      .map((draft) => ({
        threadId: `${THREAD_PREFIX}${draft.id}`,
        title: draft.subject || `Draft to ${draft.toName}`,
        project: 'Gmail',
        attention: 'report' as const,
        updatedAt: draft.updatedAt,
        app: 'gmail' as const,
      }));
  }

  async getSource(threadId: string): Promise<SourceDetail> {
    const draft = await this.drafts.getDraft(draftId(threadId));
    const hash = createHash('sha1').update(draft.body).digest('hex').slice(0, 12);
    const evidence = await this.evidenceFor(draft.toName, draft.subject);
    const source: AttentionSource = {
      sourceMessageId: `gmail-${draft.id}-${hash}`,
      text: draft.body,
      kind: 'reply',
      app: 'gmail',
      ...(evidence.length > 0 ? { evidence: { notes: evidence } } : {}),
      target: {
        name: draft.toName,
        recipient: draft.toName,
        subject: draft.subject,
        link: draft.link,
      },
    };
    return { source, app: 'gmail' };
  }

  async edit(input: SourceEditInput): Promise<EditResult> {
    const result = await editSentence({
      before: input.before,
      note: input.text,
      ...(input.llm ? { llm: input.llm } : {}),
    });
    return {
      ok: result.ok,
      pointId: input.point.id,
      before: input.before,
      ...(result.after !== undefined ? { after: result.after } : {}),
      ...(result.method ? { method: result.method } : {}),
      ...(result.error ? { error: result.error } : {}),
    };
  }

  async deliver(input: SourceDeliveryInput): Promise<SourceDelivery> {
    const id = draftId(input.thread.threadId);
    const draft = await this.drafts.getDraft(id);
    const edited = applyDraftEdits(draft.body, input.deck, input.draft);
    if (edited.applied > 0 && edited.text !== draft.body) {
      await this.drafts.updateDraft(id, edited.text);
    }
    const sent = await this.drafts.sendDraft(id);
    const receipt = gmailReceipt({
      to: draft.toName || input.source.target?.recipient || 'them',
      link: sent.link || draft.link,
    });
    return { delivered: 'gmail', receipt };
  }

  private async evidenceFor(toName: string, subject: string): Promise<NoteHit[]> {
    if (!this.notes) return [];
    const query = subjectQuery(subject, toName).trim();
    if (query.length === 0) return [];
    try {
      return await this.notes.search(query, 5);
    } catch {
      // Evidence is optional: no note, no flag.
      return [];
    }
  }
}
